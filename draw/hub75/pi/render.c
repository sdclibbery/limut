#include "render.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef HUB75_GLES

/* ---- no GPU on this build ----------------------------------------------------------------- */

renderer *render_create(const char *node, int w, int h, char *err, size_t errCap) {
    (void)node; (void)w; (void)h;
    snprintf(err, errCap, "built without HUB75_GLES: no EGL/GBM on this platform");
    return NULL;
}
void render_destroy(renderer *r) { (void)r; }
const char *render_gl_version(renderer *r) { (void)r; return "none"; }
const char *render_gl_renderer(renderer *r) { (void)r; return "none"; }
int render_max_texture_size(renderer *r) { (void)r; return 0; }
int render_build_program(renderer *r, prog_entry *p, int *isLink) {
    (void)r; (void)p; (void)isLink; return 0;
}
int render_upload_asset(renderer *r, asset_entry *a, char *err, size_t errCap) {
    (void)r; (void)a; (void)err; (void)errCap; return 0;
}
void render_release_asset(renderer *r, asset_entry *a) { (void)r; (void)a; }
int render_frame(renderer *r, prog_entry *p, asset_entry *const *tex, int nTex,
                 const float *values, int nUniforms, uint8_t *rgba, char *err, size_t errCap) {
    (void)r; (void)p; (void)tex; (void)nTex; (void)values; (void)nUniforms; (void)rgba;
    (void)err; (void)errCap;
    return 0;
}

#else

#include <fcntl.h>
#include <math.h>
#include <unistd.h>
#include <gbm.h>
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES3/gl3.h>

/* PROTOCOL.md §13: byte for byte common.vtxShader from draw/shadercommon.js. Not a place to
 * improvise — the attribute names are what render_build_program binds by location. */
static const char *VTX_SHADER =
    "#version 300 es\n"
    "in vec2 posIn;\n"
    "in vec2 fragCoordIn;\n"
    "out vec2 fragCoord;\n"
    "void main() { gl_Position = vec4(posIn, 0, 1); fragCoord = fragCoordIn; }\n";

enum { ATTR_POS = 0, ATTR_FRAGCOORD = 1 };

struct renderer {
    int                fd;
    struct gbm_device *gbm;
    EGLDisplay         dpy;
    EGLContext         ctx;
    int                w, h;
    GLuint             fbo, colorTex;
    GLuint             vao, vbo;
    GLuint             vtx;
    char               version[128];
    char               rendererName[128];
    int                maxTextureSize;
    uint8_t           *readBuf;   /* glReadPixels lands here, bottom row first */
};

static GLuint compile_shader(GLenum type, const char *src, char *log, size_t logCap) {
    GLuint s = glCreateShader(type);
    GLint ok = 0;
    glShaderSource(s, 1, &src, NULL);
    glCompileShader(s);
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (ok) return s;
    if (log && logCap) {
        GLsizei n = 0;
        glGetShaderInfoLog(s, (GLsizei)logCap - 1, &n, log);
        log[n < (GLsizei)logCap ? n : (GLsizei)logCap - 1] = 0;
        if (!log[0]) snprintf(log, logCap, "shader failed to compile, driver gave no log");
    }
    glDeleteShader(s);
    return 0;
}

/* The fullscreen quad of §13: two triangles, six vertices, posIn over NDC [-1,1]^2 and
 * fragCoordIn over [-har,har] x [-ihar,ihar] y-up. The winding and the pairing are taken from
 * verts() in draw/sprite.js so the same px chain lands the same way up as it does in a browser. */
static void build_geometry(renderer *r) {
    float har = (float)r->w / (float)r->h, ihar = 1.0f;
    float v[24];
    int i = 0;
    /* Aspect softening: a HUB75 wall is easily 4:1, and without this the image is unusably
     * stretched. Straight out of draw/sprite.js. */
    if (har > 2.0f || har < 0.5f) { har = sqrtf(har); ihar = 1.0f / har; }

#define VERT(px, py, tx, ty) do { \
        v[i++] = (px); v[i++] = (py); v[i++] = (tx); v[i++] = (ty); \
    } while (0)
    VERT(-1, -1, -har, -ihar);
    VERT( 1, -1,  har, -ihar);
    VERT(-1,  1, -har,  ihar);
    VERT(-1,  1, -har,  ihar);
    VERT( 1, -1,  har, -ihar);
    VERT( 1,  1,  har,  ihar);
#undef VERT

    glGenVertexArrays(1, &r->vao);
    glBindVertexArray(r->vao);
    glGenBuffers(1, &r->vbo);
    glBindBuffer(GL_ARRAY_BUFFER, r->vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof v, v, GL_STATIC_DRAW);
    glEnableVertexAttribArray(ATTR_POS);
    glVertexAttribPointer(ATTR_POS, 2, GL_FLOAT, GL_FALSE, 16, (void *)0);
    glEnableVertexAttribArray(ATTR_FRAGCOORD);
    glVertexAttribPointer(ATTR_FRAGCOORD, 2, GL_FLOAT, GL_FALSE, 16, (void *)8);
}

renderer *render_create(const char *node, int w, int h, char *err, size_t errCap) {
    renderer *r = (renderer *)calloc(1, sizeof *r);
    PFNEGLGETPLATFORMDISPLAYEXTPROC getPlatformDisplay;
    EGLint major, minor, n = 0;
    EGLConfig cfg;
    const EGLint cfgAttr[] = {
        EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
        EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
        EGL_NONE
    };
    const EGLint ctxAttr[] = { EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 0, EGL_NONE };
    char log[1024];

    if (!r) { snprintf(err, errCap, "out of memory"); return NULL; }
    r->w = w;
    r->h = h;
    r->fd = open(node, O_RDWR);
    if (r->fd < 0) { snprintf(err, errCap, "cannot open render node %s", node); goto fail; }
    r->gbm = gbm_create_device(r->fd);
    if (!r->gbm) { snprintf(err, errCap, "gbm_create_device failed on %s", node); goto fail; }

    getPlatformDisplay = (PFNEGLGETPLATFORMDISPLAYEXTPROC)eglGetProcAddress("eglGetPlatformDisplayEXT");
    r->dpy = getPlatformDisplay ? getPlatformDisplay(EGL_PLATFORM_GBM_KHR, r->gbm, NULL)
                                : eglGetDisplay((EGLNativeDisplayType)r->gbm);
    if (r->dpy == EGL_NO_DISPLAY) { snprintf(err, errCap, "no EGL display for the GBM device"); goto fail; }
    if (!eglInitialize(r->dpy, &major, &minor)) { snprintf(err, errCap, "eglInitialize failed"); goto fail; }
    if (!eglBindAPI(EGL_OPENGL_ES_API)) { snprintf(err, errCap, "eglBindAPI(ES) failed"); goto fail; }
    if (!eglChooseConfig(r->dpy, cfgAttr, &cfg, 1, &n) || n <= 0) {
        snprintf(err, errCap, "no ES3-renderable EGLConfig"); goto fail;
    }
    r->ctx = eglCreateContext(r->dpy, cfg, EGL_NO_CONTEXT, ctxAttr);
    if (r->ctx == EGL_NO_CONTEXT) { snprintf(err, errCap, "eglCreateContext failed"); goto fail; }
    /* Surfaceless: nothing is ever presented, every frame goes to an FBO and comes back through
     * glReadPixels. */
    if (!eglMakeCurrent(r->dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, r->ctx)) {
        snprintf(err, errCap, "eglMakeCurrent with EGL_NO_SURFACE failed"); goto fail;
    }

    snprintf(r->version, sizeof r->version, "%s", (const char *)glGetString(GL_VERSION));
    snprintf(r->rendererName, sizeof r->rendererName, "%s", (const char *)glGetString(GL_RENDERER));
    glGetIntegerv(GL_MAX_TEXTURE_SIZE, &r->maxTextureSize);

    if (w > r->maxTextureSize || h > r->maxTextureSize) {
        snprintf(err, errCap, "panel %dx%d exceeds GL_MAX_TEXTURE_SIZE %d", w, h, r->maxTextureSize);
        goto fail;
    }

    glGenTextures(1, &r->colorTex);
    glBindTexture(GL_TEXTURE_2D, r->colorTex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glGenFramebuffers(1, &r->fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, r->fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, r->colorTex, 0);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
        snprintf(err, errCap, "framebuffer incomplete at %dx%d", w, h);
        goto fail;
    }

    build_geometry(r);

    r->vtx = compile_shader(GL_VERTEX_SHADER, VTX_SHADER, log, sizeof log);
    if (!r->vtx) { snprintf(err, errCap, "the constant vertex shader failed to compile: %s", log); goto fail; }

    r->readBuf = (uint8_t *)malloc((size_t)w * h * 4);
    if (!r->readBuf) { snprintf(err, errCap, "out of memory for the readback buffer"); goto fail; }

    /* No blending in version 1: a single layer over opaque black (§13). */
    glDisable(GL_BLEND);
    glDisable(GL_DEPTH_TEST);
    return r;

fail:
    render_destroy(r);
    return NULL;
}

void render_destroy(renderer *r) {
    if (!r) return;
    if (r->dpy != EGL_NO_DISPLAY) {
        eglMakeCurrent(r->dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        if (r->ctx != EGL_NO_CONTEXT) eglDestroyContext(r->dpy, r->ctx);
        eglTerminate(r->dpy);
    }
    if (r->gbm) gbm_device_destroy(r->gbm);
    if (r->fd >= 0) close(r->fd);
    free(r->readBuf);
    free(r);
}

const char *render_gl_version(renderer *r) { return r ? r->version : "none"; }
const char *render_gl_renderer(renderer *r) { return r ? r->rendererName : "none"; }
int render_max_texture_size(renderer *r) { return r ? r->maxTextureSize : 0; }

int render_build_program(renderer *r, prog_entry *p, int *isLink) {
    GLuint fs, prog;
    GLint linked = 0;
    char log[2048];
    int i;

    *isLink = 0;
    if (!r || p->glBuilt) return p->ok ? 0 : -1;
    p->glBuilt = 1;

    fs = compile_shader(GL_FRAGMENT_SHADER, p->frag, log, sizeof log);
    if (!fs) { cache_prog_fail(p, log); return -1; }

    prog = glCreateProgram();
    glAttachShader(prog, r->vtx);
    glAttachShader(prog, fs);
    /* Bound by location rather than looked up, so the one VAO built at startup serves every
     * program. */
    glBindAttribLocation(prog, ATTR_POS, "posIn");
    glBindAttribLocation(prog, ATTR_FRAGCOORD, "fragCoordIn");
    glLinkProgram(prog);
    glDeleteShader(fs); /* the program holds its own reference now */
    glGetProgramiv(prog, GL_LINK_STATUS, &linked);
    if (!linked) {
        GLsizei n = 0;
        glGetProgramInfoLog(prog, sizeof log - 1, &n, log);
        log[n < (GLsizei)sizeof log ? n : (GLsizei)sizeof log - 1] = 0;
        if (!log[0]) snprintf(log, sizeof log, "program failed to link, driver gave no log");
        glDeleteProgram(prog);
        *isLink = 1;
        cache_prog_fail(p, log);
        return -1;
    }

    p->glProg = prog;
    /* Slot i is uniforms[i]: positional, exactly as it is on the wire (§12.1). A location may
     * legitimately be -1 when the compiler proved the uniform unused; that is not an error, and
     * glUniform4fv on -1 is a documented no-op. */
    p->uniformLoc = (int *)malloc((size_t)(p->nUniforms > 0 ? p->nUniforms : 1) * sizeof(int));
    if (!p->uniformLoc) { cache_prog_fail(p, "out of memory"); return -1; }
    for (i = 0; i < p->nUniforms; i++)
        p->uniformLoc[i] = glGetUniformLocation(prog, p->uniforms[i]);
    for (i = 0; i < 16; i++) {
        char n1[32], n2[32];
        snprintf(n1, sizeof n1, "u_vstex%d", i);
        snprintf(n2, sizeof n2, "u_vsex%d", i);
        p->texLoc[i] = glGetUniformLocation(prog, n1);
        p->exLoc[i] = glGetUniformLocation(prog, n2);
    }
    p->ok = 1;
    return 0;
}

int render_upload_asset(renderer *r, asset_entry *a, char *err, size_t errCap) {
    GLenum target;
    int w, h, d;

    if (!r || a->glTex) return 0;
    if (a->kind != ASSET_LUT) {
        snprintf(err, errCap, "asset kind %d cannot be uploaded (only luts are supported in v1)", a->kind);
        return -1;
    }
    /* §6.1: a 1d lut is a size x 1 2D texture (GLES has no 1D textures); 2d is size x size;
     * 3d is TEXTURE_3D with x varying fastest, then y, then z. */
    if (a->dims == 1)      { target = GL_TEXTURE_2D; w = a->size; h = 1;       d = 1; }
    else if (a->dims == 2) { target = GL_TEXTURE_2D; w = a->size; h = a->size; d = 1; }
    else if (a->dims == 3) { target = GL_TEXTURE_3D; w = a->size; h = a->size; d = a->size; }
    else { snprintf(err, errCap, "lut dims %d is not 1, 2 or 3", a->dims); return -1; }

    if (a->size > r->maxTextureSize) {
        snprintf(err, errCap, "lut size %d exceeds maxTextureSize %d", a->size, r->maxTextureSize);
        return -1;
    }

    glGenTextures(1, &a->glTex);
    glBindTexture(target, a->glTex);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1); /* a 1d lut row is size*4 bytes; never assume 4-align */
    if (target == GL_TEXTURE_3D)
        glTexImage3D(target, 0, GL_RGBA8, w, h, d, 0, GL_RGBA, GL_UNSIGNED_BYTE, a->data);
    else
        glTexImage2D(target, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, a->data);
    /* LINEAR and CLAMP_TO_EDGE on every axis, matching draw/sprite.js (§13). */
    glTexParameteri(target, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(target, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(target, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(target, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    if (target == GL_TEXTURE_3D) glTexParameteri(target, GL_TEXTURE_WRAP_R, GL_CLAMP_TO_EDGE);
    if (glGetError() != GL_NO_ERROR) {
        snprintf(err, errCap, "GL rejected the %dd lut of size %d", a->dims, a->size);
        glDeleteTextures(1, &a->glTex);
        a->glTex = 0;
        return -1;
    }
    a->glIs3d = (target == GL_TEXTURE_3D);
    /* §13: u_vsex MUST stay (0,0) for a lut. draw/visualsynth/lut.js deliberately gives lut
     * textures no width/height so no aspect correction is applied, and the tex node's generated
     * code guards on u_vsex.y > 0.0. Reporting the real size here would silently change the
     * picture relative to the browser. */
    a->glW = 0;
    a->glH = 0;
    return 0;
}

void render_release_asset(renderer *r, asset_entry *a) {
    (void)r;
    if (a->glTex) { glDeleteTextures(1, &a->glTex); a->glTex = 0; }
}

int render_frame(renderer *r, prog_entry *p, asset_entry *const *tex, int nTex,
                 const float *values, int nUniforms, uint8_t *rgba, char *err, size_t errCap) {
    int i, y;
    size_t stride;

    if (!r) return 0;
    glBindFramebuffer(GL_FRAMEBUFFER, r->fbo);
    glViewport(0, 0, r->w, r->h);
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);

    if (p && p->ok) {
        glUseProgram(p->glProg);
        glBindVertexArray(r->vao);
        for (i = 0; i < nUniforms && i < p->nUniforms; i++)
            glUniform4fv(p->uniformLoc[i], 1, values + i * 4);
        for (i = 0; i < nTex && i < 16; i++) {
            asset_entry *a = tex[i];
            glActiveTexture((GLenum)(GL_TEXTURE0 + i));
            glBindTexture(a->glIs3d ? GL_TEXTURE_3D : GL_TEXTURE_2D, a->glTex);
            glUniform1i(p->texLoc[i], i);
            glUniform2f(p->exLoc[i], (float)a->glW, (float)a->glH);
        }
        glDrawArrays(GL_TRIANGLES, 0, 6);
    }

    glReadPixels(0, 0, r->w, r->h, GL_RGBA, GL_UNSIGNED_BYTE, r->readBuf);
    if (glGetError() != GL_NO_ERROR) {
        snprintf(err, errCap, "GL error during render or readback");
        return -1;
    }
    /* glReadPixels hands back row 0 = the bottom of the framebuffer, but row 0 of the output is
     * the top of the panel. fragCoord is y-up (§13), so this flip is what makes the panel agree
     * with the browser rather than showing the image upside down. */
    stride = (size_t)r->w * 4;
    for (y = 0; y < r->h; y++)
        memcpy(rgba + (size_t)y * stride, r->readBuf + (size_t)(r->h - 1 - y) * stride, stride);
    return 0;
}

#endif /* HUB75_GLES */
