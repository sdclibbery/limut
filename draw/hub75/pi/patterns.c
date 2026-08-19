#include "patterns.h"
#include <string.h>

int pattern_by_name(const char *s) {
    if (!s) return -1;
    if (!strcmp(s, "off"))  return PATTERN_OFF;
    if (!strcmp(s, "bars")) return PATTERN_BARS;
    if (!strcmp(s, "grid")) return PATTERN_GRID;
    return -1;
}

const char *pattern_name(int pattern) {
    return pattern == PATTERN_BARS ? "bars" : pattern == PATTERN_GRID ? "grid" : "off";
}

static void px(uint8_t *rgba, int w, int x, int y, int r, int g, int b) {
    uint8_t *p = rgba + ((size_t)y * w + x) * 4;
    p[0] = (uint8_t)r; p[1] = (uint8_t)g; p[2] = (uint8_t)b; p[3] = 255;
}

void pattern_render(int pattern, int w, int h, uint8_t *rgba) {
    /* Full-intensity primaries and secondaries: the point of bars is checking that every channel
     * reaches the panel and that no two are swapped in the mapping. */
    static const int BARS[8][3] = {
        {255,255,255}, {255,255,0}, {0,255,255}, {0,255,0},
        {255,0,255},   {255,0,0},   {0,0,255},   {0,0,0}
    };
    int x, y;

    memset(rgba, 0, (size_t)w * h * 4);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) rgba[((size_t)y * w + x) * 4 + 3] = 255;
    if (pattern == PATTERN_OFF) return;

    if (pattern == PATTERN_BARS) {
        for (y = 0; y < h; y++) {
            for (x = 0; x < w; x++) {
                int i = (int)((long)x * 8 / (w > 0 ? w : 1));
                if (i > 7) i = 7;
                px(rgba, w, x, y, BARS[i][0], BARS[i][1], BARS[i][2]);
            }
        }
        return;
    }

    /* grid: a one-pixel border plus a line every 8, for checking panel mapping and finding the
     * seams between panels. The corners are coloured so orientation is unambiguous — a wall
     * assembled upside down looks identical under a symmetric grid. */
    for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
            int edge = (x == 0 || y == 0 || x == w - 1 || y == h - 1);
            int line = (x % 8 == 0 || y % 8 == 0);
            if (edge)      px(rgba, w, x, y, 255, 255, 255);
            else if (line) px(rgba, w, x, y, 64, 64, 64);
        }
    }
    for (y = 0; y < 3 && y < h; y++) for (x = 0; x < 3 && x < w; x++) {
        px(rgba, w, x, y, 255, 0, 0);                       /* top left: red */
        px(rgba, w, w - 1 - x, y, 0, 255, 0);               /* top right: green */
        px(rgba, w, x, h - 1 - y, 0, 0, 255);               /* bottom left: blue */
    }
}
