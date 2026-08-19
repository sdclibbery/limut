/* glsl.h - structural checks on a shader source, with no GL involved.
 *
 * These are the checks from mock/display.js `checkProgram` / `checkTextures`, and they run even
 * on the Pi where a real compiler is available. A driver compiles `uniform vec4 u_vs0;` happily
 * whatever the announced list says, but the uniform slot index is POSITIONAL on the wire
 * (PROTOCOL.md §7.1) — so a declared list that disagrees with the source is a silent
 * wrong-picture bug that only a check like this one can catch.
 */
#ifndef HUB75_GLSL_H
#define HUB75_GLSL_H

#include <stddef.h>

#define GLSL_MAX_UNIFORMS 512
#define GLSL_MAX_TEXTURES 16

/* Collects the `uniform vec4 u_vsN;` declarations in source order. Returns the count, or -1 if
 * there are more than `max`. Each name is copied into names[i], which must hold 32 bytes. */
int glsl_declared_uniforms(const char *frag, char names[][32], int max);

/* Sampler kind per texture unit: kinds[u] is 2 for sampler2D, 3 for sampler3D, 0 for a unit with
 * no declaration. Returns unitCount (highest declared unit + 1), or -1 on overflow. */
int glsl_declared_samplers(const char *frag, int kinds[], int max);

/* 0 if the source is well formed and its uniform declarations match `uniforms` exactly;
 * -1 with a human-readable reason in `err` (which is what goes into error.log). */
int glsl_check_program(const char *frag, char *const *uniforms, int nUniforms,
                       char *err, size_t errCap);

/* 0 if the layer's bound sampler kinds match the source's declarations. `bound[u]` is 2 or 3. */
int glsl_check_textures(const char *frag, const int bound[], int nBound, char *err, size_t errCap);

#endif
