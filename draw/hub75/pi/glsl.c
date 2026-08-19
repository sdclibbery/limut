#include "glsl.h"
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

static int is_word(char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_';
}

static const char *skip_ws(const char *p) {
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') p++;
    return p;
}

/* Literal keyword at p, ending on a word boundary. */
static const char *kw(const char *p, const char *w) {
    size_t n = strlen(w);
    if (strncmp(p, w, n) != 0) return NULL;
    if (is_word(p[n])) return NULL;
    return p + n;
}

/* Next occurrence of identifier `w` starting on a word boundary, at or after `from`. */
static const char *find_kw(const char *base, const char *from, const char *w) {
    size_t n = strlen(w);
    const char *p = from;
    for (; *p; p++) {
        if (strncmp(p, w, n) != 0) continue;
        if (p > base && is_word(p[-1])) continue;
        if (is_word(p[n])) continue;
        return p;
    }
    return NULL;
}

/* An identifier at p; copies at most cap-1 chars. Returns the position after it, or NULL. */
static const char *ident(const char *p, char *out, size_t cap) {
    size_t n = 0;
    if (!is_word(*p) || (*p >= '0' && *p <= '9')) return NULL;
    while (is_word(*p)) {
        if (n + 1 < cap) out[n] = *p;
        n++;
        p++;
    }
    out[n < cap ? n : cap - 1] = 0;
    return p;
}

/* `u_vs<digits>` exactly */
static int is_vs_name(const char *s, const char *prefix) {
    size_t n = strlen(prefix);
    if (strncmp(s, prefix, n) != 0) return 0;
    s += n;
    if (!*s) return 0;
    for (; *s; s++) if (*s < '0' || *s > '9') return 0;
    return 1;
}

static int vs_index(const char *s, const char *prefix) {
    int v = 0;
    s += strlen(prefix);
    for (; *s; s++) v = v * 10 + (*s - '0');
    return v;
}

int glsl_declared_uniforms(const char *frag, char names[][32], int max) {
    const char *p = frag;
    int count = 0;
    for (;;) {
        const char *q = find_kw(frag, p, "uniform");
        char name[32];
        if (!q) break;
        p = q + 7;
        q = kw(skip_ws(p), "vec4");
        if (!q) continue;
        q = ident(skip_ws(q), name, sizeof name);
        if (!q) continue;
        if (*skip_ws(q) != ';') continue;
        if (!is_vs_name(name, "u_vs")) continue;
        if (count >= max) return -1;
        snprintf(names[count], 32, "%s", name);
        count++;
    }
    return count;
}

int glsl_declared_samplers(const char *frag, int kinds[], int max) {
    const char *p = frag;
    int units = 0, i;
    for (i = 0; i < max; i++) kinds[i] = 0;
    for (;;) {
        const char *q = find_kw(frag, p, "uniform");
        char name[32];
        int kind;
        if (!q) break;
        p = q + 7;
        q = skip_ws(p);
        if (kw(q, "sampler2D")) { kind = 2; q = kw(q, "sampler2D"); }
        else if (kw(q, "sampler3D")) { kind = 3; q = kw(q, "sampler3D"); }
        else continue;
        q = ident(skip_ws(q), name, sizeof name);
        if (!q) continue;
        if (*skip_ws(q) != ';') continue;
        if (!is_vs_name(name, "u_vstex")) continue;
        {
            int u = vs_index(name, "u_vstex");
            if (u < 0 || u >= max) return -1;
            kinds[u] = kind;
            if (u + 1 > units) units = u + 1;
        }
    }
    return units;
}

/* `void main (` with any whitespace between the parts */
static int has_main(const char *frag) {
    const char *p = frag;
    for (;;) {
        const char *q = find_kw(frag, p, "void");
        if (!q) return 0;
        p = q + 4;
        q = kw(skip_ws(p), "main");
        if (!q) continue;
        if (*skip_ws(q) == '(') return 1;
    }
}

/* A declaration like `out vec4 fragColor` or `in vec2 fragCoord`. */
static int has_decl(const char *frag, const char *qual, const char *type, const char *name) {
    const char *p = frag;
    for (;;) {
        const char *q = find_kw(frag, p, qual);
        char got[32];
        if (!q) return 0;
        p = q + strlen(qual);
        q = kw(skip_ws(p), type);
        if (!q) continue;
        q = ident(skip_ws(q), got, sizeof got);
        if (!q) continue;
        if (strcmp(got, name) == 0) return 1;
    }
}

/* Appends one problem line to `err`, newline separated, never overflowing. Returning the joined
 * text rather than the first problem matters: a host that sent a shader with two things wrong
 * should learn both from one error message. */
static void add_line(char *err, size_t cap, size_t *used, const char *fmt, ...) {
    va_list ap;
    int n;
    if (cap == 0 || *used + 1 >= cap) return;
    if (*used) { err[(*used)++] = '\n'; err[*used] = 0; }
    if (*used + 1 >= cap) return;
    va_start(ap, fmt);
    n = vsnprintf(err + *used, cap - *used, fmt, ap);
    va_end(ap);
    if (n < 0) return;
    *used += (size_t)n;
    if (*used >= cap) *used = cap - 1;
}

/* Comma-joins a name list for an error message. */
static void join(char *out, size_t cap, char *const *names, int n) {
    size_t used = 0;
    int i;
    out[0] = 0;
    for (i = 0; i < n; i++) {
        int w = snprintf(out + used, cap - used, "%s%s", i ? ", " : "", names[i]);
        if (w < 0) return;
        used += (size_t)w;
        if (used >= cap) { out[cap - 1] = 0; return; }
    }
}

int glsl_check_program(const char *frag, char *const *uniforms, int nUniforms,
                       char *err, size_t errCap) {
    char declared[GLSL_MAX_UNIFORMS][32];
    char *declaredPtr[GLSL_MAX_UNIFORMS];
    int n, i;
    size_t used = 0;

    if (errCap) err[0] = 0;

    if (strncmp(frag, "#version 300 es", 15) != 0 || is_word(frag[15]))
        add_line(err, errCap, &used, "source must begin with #version 300 es");
    if (!has_main(frag))
        add_line(err, errCap, &used, "no main()");
    if (!has_decl(frag, "out", "vec4", "fragColor"))
        add_line(err, errCap, &used, "no `out vec4 fragColor` declaration");
    if (!has_decl(frag, "in", "vec2", "fragCoord"))
        add_line(err, errCap, &used, "no `in vec2 fragCoord` declaration");

    n = glsl_declared_uniforms(frag, declared, GLSL_MAX_UNIFORMS);
    if (n < 0) {
        add_line(err, errCap, &used, "more than %d uniforms declared", GLSL_MAX_UNIFORMS);
    } else {
        int same = (n == nUniforms);
        for (i = 0; same && i < n; i++) if (strcmp(declared[i], uniforms[i]) != 0) same = 0;
        if (!same) {
            /* Both lists spelled out in full: the host cannot see the source it sent, and this
             * message is the only thing that tells it which end is wrong. */
            char a[512], b[512];
            for (i = 0; i < n; i++) declaredPtr[i] = declared[i];
            join(a, sizeof a, uniforms, nUniforms);
            join(b, sizeof b, declaredPtr, n);
            add_line(err, errCap, &used, "uniform list [%s] does not match the source's [%s]", a, b);
        }
    }
    return used ? -1 : 0;
}

int glsl_check_textures(const char *frag, const int bound[], int nBound, char *err, size_t errCap) {
    int kinds[GLSL_MAX_TEXTURES];
    int units = glsl_declared_samplers(frag, kinds, GLSL_MAX_TEXTURES);
    int i;
    err[0] = 0;
    if (units < 0) {
        snprintf(err, errCap, "shader declares a texture unit above %d", GLSL_MAX_TEXTURES - 1);
        return -1;
    }
    if (units != nBound) {
        snprintf(err, errCap, "shader declares %d texture unit(s), the layer binds %d", units, nBound);
        return -1;
    }
    for (i = 0; i < units; i++) {
        if (kinds[i] == bound[i]) continue;
        snprintf(err, errCap, "texture unit %d: shader declares %s, the layer binds %s", i,
                 kinds[i] == 2 ? "sampler2D" : kinds[i] == 3 ? "sampler3D" : "nothing",
                 bound[i] == 2 ? "sampler2D" : bound[i] == 3 ? "sampler3D" : "nothing");
        return -1;
    }
    return 0;
}
