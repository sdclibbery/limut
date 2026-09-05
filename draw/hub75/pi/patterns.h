/* patterns.h - the built-in test patterns of PROTOCOL.md §10, for bring-up before any shader
 * exists. Generated entirely by the display; the dimmer applies to them like anything else. */
#ifndef HUB75_PATTERNS_H
#define HUB75_PATTERNS_H

#include <stdint.h>

enum { PATTERN_OFF = 0, PATTERN_BARS = 1, PATTERN_GRID = 2,
       PATTERN_WHITE = 3, PATTERN_RED = 4, PATTERN_GREEN = 5, PATTERN_BLUE = 6,
       PATTERN_MAP = 7, PATTERN_ROWID = 8, PATTERN_BANDS = 9, PATTERN_CELLID = 10,
       PATTERN_CORNERS = 11 };

/* Arm length of PATTERN_CORNERS' L, in pixels, counted along each edge from the corner. */
#define PATTERN_CORNER_ARM 3

/* The cell size PATTERN_MAP numbers in. One module of the panels in use — see ../CLAUDE.md. */
#define PATTERN_CELL_W 64
#define PATTERN_CELL_H 32

/* -1 if `s` is not a pattern name. */
int  pattern_by_name(const char *s);
const char *pattern_name(int pattern);

/* Fills w*h*4 RGBA8. PATTERN_OFF fills opaque black. */
void pattern_render(int pattern, int w, int h, uint8_t *rgba);

#endif
