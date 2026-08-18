/*
 * egl-probe.c - headless GPU capability probe for the limut HUB75 render node.
 *
 * Answers the question the whole project rests on: can this board compile the
 * GLSL ES 3.00 that limut emits, render it offscreen with no X or Wayland, and
 * read the pixels back?
 *
 * Deliberately exercises the specific features limut's shaders use:
 *   - "#version 300 es" with in/out rather than attribute/varying
 *   - texture() rather than texture2D()
 *   - sampler3D, which draw/visualsynth/lut.js needs for 3D LUTs and which the
 *     older VideoCore IV could not do at all
 *
 * Build: gcc -O2 -o egl-probe egl-probe.c -lEGL -lGLESv2 -lgbm
 * Run:   ./egl-probe [render-node]     (default /dev/dri/renderD128)
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <gbm.h>
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GLES3/gl3.h>

#define W 64
#define H 64

static int failures = 0;

static void check(const char *what, int ok) {
    printf("  [%s] %s\n", ok ? "PASS" : "FAIL", what);
    if (!ok) failures++;
}

static GLuint compile(GLenum type, const char *src, const char *label) {
    GLuint s = glCreateShader(type);
    glShaderSource(s, 1, &src, NULL);
    glCompileShader(s);
    GLint ok = 0;
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[2048] = {0};
        glGetShaderInfoLog(s, sizeof log - 1, NULL, log);
        printf("  [FAIL] %s failed to compile:\n%s\n", label, log);
        failures++;
        return 0;
    }
    printf("  [PASS] %s compiled\n", label);
    return s;
}

/* Uses in/out and texture(): GLSL ES 3.00 syntax, not 1.00. */
static const char *VS =
    "#version 300 es\n"
    "in vec2 pos;\n"
    "void main() { gl_Position = vec4(pos, 0.0, 1.0); }\n";

/* sampler3D has no default precision in GLSL ES 3.00 and must be declared,
 * exactly as draw/visualsynth/codegen.js does when a 3d lookup is present. */
static const char *FS =
    "#version 300 es\n"
    "precision highp float;\n"
    "precision highp sampler3D;\n"
    "uniform sampler3D lut;\n"
    "uniform vec2 res;\n"
    "out vec4 fragColor;\n"
    "void main() {\n"
    "  vec2 uv = gl_FragCoord.xy / res;\n"
    "  float l = texture(lut, vec3(0.5, 0.5, 0.5)).r;\n"
    "  fragColor = vec4(uv.x, uv.y, l, 1.0);\n"
    "}\n";

int main(int argc, char **argv) {
    const char *node = (argc > 1) ? argv[1] : "/dev/dri/renderD128";

    printf("== limut HUB75 headless GPU probe ==\n");
    printf("render node: %s\n\n", node);

    int fd = open(node, O_RDWR);
    if (fd < 0) { printf("  [FAIL] cannot open %s\n", node); return 1; }

    struct gbm_device *gbm = gbm_create_device(fd);
    if (!gbm) { printf("  [FAIL] gbm_create_device\n"); return 1; }

    PFNEGLGETPLATFORMDISPLAYEXTPROC getPlatformDisplay =
        (PFNEGLGETPLATFORMDISPLAYEXTPROC) eglGetProcAddress("eglGetPlatformDisplayEXT");
    EGLDisplay dpy = getPlatformDisplay
        ? getPlatformDisplay(EGL_PLATFORM_GBM_KHR, gbm, NULL)
        : eglGetDisplay((EGLNativeDisplayType) gbm);

    EGLint major, minor;
    check("eglInitialize on GBM platform", eglInitialize(dpy, &major, &minor));
    printf("         EGL %d.%d\n", major, minor);

    check("eglBindAPI(EGL_OPENGL_ES_API)", eglBindAPI(EGL_OPENGL_ES_API));

    EGLint cfgAttr[] = {
        EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
        EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8,
        EGL_NONE
    };
    EGLConfig cfg; EGLint n = 0;
    check("an ES3-renderable EGLConfig exists",
          eglChooseConfig(dpy, cfgAttr, &cfg, 1, &n) && n > 0);

    EGLint ctxAttr[] = { EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 0, EGL_NONE };
    EGLContext ctx = eglCreateContext(dpy, cfg, EGL_NO_CONTEXT, ctxAttr);
    check("created an OpenGL ES 3.0 context", ctx != EGL_NO_CONTEXT);

    /* No surface at all: this is the surfaceless path we would use in production. */
    check("eglMakeCurrent with EGL_NO_SURFACE (surfaceless)",
          eglMakeCurrent(dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, ctx));

    printf("\n  GL_VERSION  : %s\n", glGetString(GL_VERSION));
    printf("  GL_RENDERER : %s\n", glGetString(GL_RENDERER));
    printf("  GLSL        : %s\n", glGetString(GL_SHADING_LANGUAGE_VERSION));

    GLint max3d = 0, maxTex = 0, maxRb = 0;
    glGetIntegerv(GL_MAX_3D_TEXTURE_SIZE, &max3d);
    glGetIntegerv(GL_MAX_TEXTURE_SIZE, &maxTex);
    glGetIntegerv(GL_MAX_RENDERBUFFER_SIZE, &maxRb);
    printf("  MAX_TEXTURE_SIZE=%d  MAX_3D_TEXTURE_SIZE=%d  MAX_RENDERBUFFER_SIZE=%d\n\n",
           maxTex, max3d, maxRb);
    check("3D textures supported (needed for visualsynth LUTs)", max3d > 0);

    /* --- offscreen target ------------------------------------------------ */
    GLuint tex, fbo;
    glGenTextures(1, &tex);
    glBindTexture(GL_TEXTURE_2D, tex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, W, H, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glGenFramebuffers(1, &fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
    check("framebuffer complete",
          glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE);

    /* --- a 3d LUT holding a known constant -------------------------------- */
    const int L = 4;
    unsigned char *lutData = malloc(L * L * L * 4);
    for (int i = 0; i < L * L * L; i++) {
        lutData[i*4+0] = 64;   /* r = 64/255 ~= 0.251 */
        lutData[i*4+1] = 0;
        lutData[i*4+2] = 0;
        lutData[i*4+3] = 255;
    }
    GLuint lut;
    glGenTextures(1, &lut);
    glBindTexture(GL_TEXTURE_3D, lut);
    glTexImage3D(GL_TEXTURE_3D, 0, GL_RGBA8, L, L, L, 0, GL_RGBA, GL_UNSIGNED_BYTE, lutData);
    glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_R, GL_CLAMP_TO_EDGE);
    check("glTexImage3D accepted (RGBA8 3D texture)", glGetError() == GL_NO_ERROR);

    /* --- program ---------------------------------------------------------- */
    GLuint vs = compile(GL_VERTEX_SHADER,   VS, "vertex shader   (#version 300 es)");
    GLuint fs = compile(GL_FRAGMENT_SHADER, FS, "fragment shader (#version 300 es, sampler3D)");
    if (!vs || !fs) { printf("\nRESULT: FAILED (%d)\n", failures); return 1; }

    GLuint prog = glCreateProgram();
    glAttachShader(prog, vs); glAttachShader(prog, fs);
    glBindAttribLocation(prog, 0, "pos");
    glLinkProgram(prog);
    GLint linked = 0; glGetProgramiv(prog, GL_LINK_STATUS, &linked);
    if (!linked) {
        char log[2048] = {0};
        glGetProgramInfoLog(prog, sizeof log - 1, NULL, log);
        printf("  [FAIL] link: %s\n", log);
        failures++;
    } else {
        printf("  [PASS] program linked\n");
    }
    glUseProgram(prog);
    glUniform2f(glGetUniformLocation(prog, "res"), (float) W, (float) H);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_3D, lut);
    glUniform1i(glGetUniformLocation(prog, "lut"), 0);

    /* --- fullscreen triangle ---------------------------------------------- */
    const GLfloat verts[] = { -1.f, -1.f,  3.f, -1.f,  -1.f, 3.f };
    GLuint vao, vbo;
    glGenVertexArrays(1, &vao);          /* VAOs are core in GLES 3, absent in GLES 2 */
    glBindVertexArray(vao);
    glGenBuffers(1, &vbo);
    glBindBuffer(GL_ARRAY_BUFFER, vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof verts, verts, GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, (void *) 0);
    check("vertex array object created (GLES 3 feature)", glGetError() == GL_NO_ERROR);

    glViewport(0, 0, W, H);
    glClearColor(0.f, 0.f, 0.f, 1.f);
    glClear(GL_COLOR_BUFFER_BIT);
    glDrawArrays(GL_TRIANGLES, 0, 3);
    glFinish();
    check("draw call produced no GL error", glGetError() == GL_NO_ERROR);

    /* --- read back --------------------------------------------------------- */
    unsigned char *px = malloc(W * H * 4);
    glReadPixels(0, 0, W, H, GL_RGBA, GL_UNSIGNED_BYTE, px);
    check("glReadPixels returned without error", glGetError() == GL_NO_ERROR);

    /* Expect a gradient: red rises with x, green rises with y, blue is the LUT
     * constant (~64) everywhere. Sample a few pixels rather than trusting one. */
    #define PX(x,y,c) px[(((y)*W)+(x))*4 + (c)]
    int bl_r = PX(1,1,0),      bl_g = PX(1,1,1);
    int tr_r = PX(W-2,H-2,0),  tr_g = PX(W-2,H-2,1);
    int mid_b = PX(W/2,H/2,2);

    printf("\n  sampled: bottom-left rg=(%d,%d)  top-right rg=(%d,%d)  centre b=%d\n",
           bl_r, bl_g, tr_r, tr_g, mid_b);

    check("red channel ramps along x",  tr_r > bl_r + 100);
    check("green channel ramps along y", tr_g > bl_g + 100);
    check("sampler3D returned the LUT constant (~64)", mid_b > 55 && mid_b < 75);

    printf("\nRESULT: %s (%d failure%s)\n",
           failures ? "FAILED" : "ALL CHECKS PASSED",
           failures, failures == 1 ? "" : "s");
    return failures ? 1 : 0;
}
