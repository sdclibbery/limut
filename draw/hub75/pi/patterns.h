/* patterns.h - the built-in test patterns of PROTOCOL.md §10, for bring-up before any shader
 * exists. Generated entirely by the display; the dimmer applies to them like anything else. */
#ifndef HUB75_PATTERNS_H
#define HUB75_PATTERNS_H

#include <stdint.h>

enum { PATTERN_OFF = 0, PATTERN_BARS = 1, PATTERN_GRID = 2 };

/* -1 if `s` is not a pattern name. */
int  pattern_by_name(const char *s);
const char *pattern_name(int pattern);

/* Fills w*h*4 RGBA8. PATTERN_OFF fills opaque black. */
void pattern_render(int pattern, int w, int h, uint8_t *rgba);

#endif
