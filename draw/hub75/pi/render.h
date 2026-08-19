/* render.h - headless GLES rendering of one layer, at panel resolution.
 *
 * The EGL/GBM setup is the path proven on the actual board by tools/egl-probe.c: a context on
 * /dev/dri/renderD128 with EGL_NO_SURFACE, so no X and no Wayland. PROTOCOL.md §13 is the
 * contract for everything above it, and the reason each choice here is not free to vary: get the
 * vertex shader, the aspect softening or the u_vsex rule wrong and the panel shows something
 * subtly different from the same px chain in the browser.
 *
 * Built out entirely when HUB75_GLES is not defined, so the daemon can be run and tested against
 * mock/selftest.js on a machine with no GPU.
 */
#ifndef HUB75_RENDER_H
#define HUB75_RENDER_H

#include "cache.h"
#include <stddef.h>
#include <stdint.h>

typedef struct renderer renderer;

/* NULL with a reason in `err` if there is no usable GPU. That is not fatal: the daemon runs on
 * with no renderer, serving test patterns and black, which is what the mock does. */
renderer *render_create(const char *node, int w, int h, char *err, size_t errCap);
void      render_destroy(renderer *r);

const char *render_gl_version(renderer *r);
const char *render_gl_renderer(renderer *r);
int         render_max_texture_size(renderer *r);

/* Compiles and links. 0 on success. On failure returns -1, sets p->log, and sets *isLink so the
 * caller can report error kind "compile" or "link" (§8). A failure is permanent: this is called
 * once per program id and never retried. */
int  render_build_program(renderer *r, prog_entry *p, int *isLink);

int  render_upload_asset(renderer *r, asset_entry *a, char *err, size_t errCap);
void render_release_asset(renderer *r, asset_entry *a);

/* Draws the bound layer and reads it back into `rgba` (w*h*4), top row first. */
int  render_frame(renderer *r, prog_entry *p, asset_entry *const *tex, int nTex,
                  const float *values, int nUniforms, uint8_t *rgba, char *err, size_t errCap);

#endif
