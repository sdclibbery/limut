/* output.h - the output stage: everything between a rendered RGBA8 frame and the panels.
 *
 * The dimmer and gamma live HERE rather than in the shader or the renderer, because
 * PROTOCOL.md §9 requires them to apply when the shader is broken, when no layer is bound, and
 * over a built-in test pattern. A backend only ever sees pixels that have already been through
 * both.
 *
 * Backends:
 *   null        discards. Used for protocol conformance runs, and on a machine with no GPU.
 *   raw         keeps the last frame so the /frame.raw debug route can serve it.
 *   colorlight  the real one. Not implemented: the 5A-75B and the panels are not in hand yet.
 */
#ifndef HUB75_OUTPUT_H
#define HUB75_OUTPUT_H

#include <stddef.h>
#include <stdint.h>

typedef struct output output_t;

struct output {
    char     backend[16];
    int      w, h;
    float    gamma;
    uint8_t  glut[256];
    uint8_t *pixels;       /* post dim, post gamma: exactly what the panels would show */
    uint64_t frames;
    int    (*write)(output_t *o);
    void   (*shutdown)(output_t *o);
    void    *state;
};

/* `backend` is one of the names above. Returns 0, or -1 with a reason in `err`. */
int  output_open(output_t *o, const char *backend, int w, int h, float gamma,
                 char *err, size_t errCap);

/* Applies the dimmer and gamma to `rgba` (w*h*4, RGBA8) and hands the result to the backend. */
int  output_frame(output_t *o, const uint8_t *rgba, float dim);

void output_close(output_t *o);

/* output_colorlight.c: the one part of the chain that is still missing. */
int  output_colorlight_write(output_t *o);
void output_colorlight_shutdown(output_t *o);

#endif
