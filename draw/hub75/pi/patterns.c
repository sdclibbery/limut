#include "patterns.h"
#include <string.h>

int pattern_by_name(const char *s) {
    if (!s) return -1;
    if (!strcmp(s, "off"))  return PATTERN_OFF;
    if (!strcmp(s, "bars")) return PATTERN_BARS;
    if (!strcmp(s, "grid")) return PATTERN_GRID;
    /* Flat fields. A patterned test says nothing when only part of the wall lights: a solid
     * colour is the same everywhere, so what comes back is about the panel, not about where in
     * the canvas the panel happens to be mapped. */
    if (!strcmp(s, "white")) return PATTERN_WHITE;
    if (!strcmp(s, "red"))   return PATTERN_RED;
    if (!strcmp(s, "green")) return PATTERN_GREEN;
    if (!strcmp(s, "blue"))  return PATTERN_BLUE;
    if (!strcmp(s, "map"))   return PATTERN_MAP;
    if (!strcmp(s, "rowid")) return PATTERN_ROWID;
    if (!strcmp(s, "bands")) return PATTERN_BANDS;
    if (!strcmp(s, "cellid")) return PATTERN_CELLID;
    return -1;
}

const char *pattern_name(int pattern) {
    switch (pattern) {
        case PATTERN_BARS:  return "bars";
        case PATTERN_GRID:  return "grid";
        case PATTERN_WHITE: return "white";
        case PATTERN_RED:   return "red";
        case PATTERN_GREEN: return "green";
        case PATTERN_BLUE:  return "blue";
        case PATTERN_MAP:   return "map";
        case PATTERN_ROWID: return "rowid";
        case PATTERN_BANDS: return "bands";
        case PATTERN_CELLID: return "cellid";
        default:            return "off";
    }
}

/* A 3x5 digit font, one byte per row, low 3 bits, top row first. Enough to print which cell of
 * the canvas a panel is showing, which is the one thing a lit panel cannot otherwise tell you. */
static const unsigned char DIGITS[10][5] = {
    {7,5,5,5,7}, {2,6,2,2,7}, {7,1,7,4,7}, {7,1,7,1,7}, {5,5,7,1,1},
    {7,4,7,1,7}, {7,4,7,5,7}, {7,1,1,1,1}, {7,5,7,5,7}, {7,5,7,1,7}
};

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

    if (pattern == PATTERN_WHITE || pattern == PATTERN_RED ||
        pattern == PATTERN_GREEN || pattern == PATTERN_BLUE) {
        int r = (pattern == PATTERN_WHITE || pattern == PATTERN_RED)   ? 255 : 0;
        int g = (pattern == PATTERN_WHITE || pattern == PATTERN_GREEN) ? 255 : 0;
        int b = (pattern == PATTERN_WHITE || pattern == PATTERN_BLUE)  ? 255 : 0;
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) px(rgba, w, x, y, r, g, b);
        return;
    }

    if (pattern == PATTERN_BANDS) {
        /* Sixteen-row bands, red / green / blue / black, repeating every 64 canvas rows. If the
         * card superimposes two canvas rows onto one physical row — which is what driving a 1/16
         * panel with a 1/32 scan configuration does — the two colours ADD, and the result names
         * the offset without any measurement:
         *
         *   red then green   : no superposition, rows land 1:1
         *   yellow then blue : rows 16 apart are being combined (red+green, blue+black)
         *   magenta then green : rows 32 apart are being combined (red+blue, green+black)
         *
         * Reportable by eye, which a row-by-row code is not. */
        for (y = 0; y < h; y++) {
            int band = (y / 16) % 4;
            int r = band == 0 ? 255 : 0;
            int g = band == 1 ? 255 : 0;
            int b = band == 2 ? 255 : 0;
            for (x = 0; x < w; x++) px(rgba, w, x, y, r, g, b);
        }
        return;
    }

    if (pattern == PATTERN_ROWID) {
        /* Each canvas row spells out its own index in binary, 9 bits wide, least significant bit
         * on the left, repeating every 64 columns so that any 64-wide panel sees a whole word
         * wherever it is mapped. One photograph of a lit panel then reads back, row by row, which
         * canvas row the card put there — which is the one thing a scan mismatch hides. */
        const int BITS = 9, BW = 7;
        for (y = 0; y < h; y++) {
            for (x = 0; x < w; x++) {
                int col = x % 64, bit = col / BW;
                int on = (bit < BITS) && ((y >> bit) & 1);
                px(rgba, w, x, y, on ? 255 : 0, on ? 255 : 0, on ? 255 : 0);
            }
        }
        return;
    }

    if (pattern == PATTERN_MAP) {
        /* Every PATTERN_CELL_W x PATTERN_CELL_H cell is bordered and stamped with its own index,
         * counting left to right then top to bottom. A panel showing "37" is cell 37, which fixes
         * exactly where in the canvas that panel is wired — no bisecting, one look. */
        int cellsX = w / PATTERN_CELL_W;
        int cx, cy, d, row, col, sc = 4, dw = 3 * sc, gap = sc;
        if (cellsX < 1) cellsX = 1;

        for (cy = 0; cy * PATTERN_CELL_H < h; cy++) {
            for (cx = 0; cx < cellsX; cx++) {
                int ox = cx * PATTERN_CELL_W, oy = cy * PATTERN_CELL_H;
                int idx = cy * cellsX + cx, nd = idx >= 100 ? 3 : idx >= 10 ? 2 : 1;
                int tw = nd * dw + (nd - 1) * gap;
                int tx = ox + (PATTERN_CELL_W - tw) / 2, ty = oy + (PATTERN_CELL_H - 5 * sc) / 2;
                int i, v;

                /* border, so cell seams and panel seams can be compared directly */
                for (x = 0; x < PATTERN_CELL_W && ox + x < w; x++) {
                    px(rgba, w, ox + x, oy, 0, 200, 0);
                    if (oy + PATTERN_CELL_H - 1 < h)
                        px(rgba, w, ox + x, oy + PATTERN_CELL_H - 1, 0, 200, 0);
                }
                for (y = 0; y < PATTERN_CELL_H && oy + y < h; y++) {
                    px(rgba, w, ox, oy + y, 0, 200, 0);
                    if (ox + PATTERN_CELL_W - 1 < w)
                        px(rgba, w, ox + PATTERN_CELL_W - 1, oy + y, 0, 200, 0);
                }
                /* a red pixel in the top left corner of every cell, so orientation is readable */
                px(rgba, w, ox, oy, 255, 0, 0);

                for (i = 0, v = idx; i < nd; i++) {
                    int digit = (v / (nd - 1 - i == 2 ? 100 : nd - 1 - i == 1 ? 10 : 1)) % 10;
                    for (row = 0; row < 5; row++)
                        for (col = 0; col < 3; col++)
                            if (DIGITS[digit][row] & (4 >> col))
                                for (d = 0; d < sc * sc; d++) {
                                    int px2 = tx + i * (dw + gap) + col * sc + d % sc;
                                    int py2 = ty + row * sc + d / sc;
                                    if (px2 < w && py2 < h) px(rgba, w, px2, py2, 255, 255, 255);
                                }
                }
            }
        }
        return;
    }

    if (pattern == PATTERN_CELLID) {
        /* The same question `map` answers — which canvas cell is this panel showing — but encoded
         * so a human eye can read it off a panel mounted sideways, at an angle, in a photograph.
         * `map`'s numerals cannot be: three rotated digits at 4x scale were misread on the first
         * six-panel wall, which is the same lesson `rowid` taught (see ../CLAUDE.md).
         *
         *   fill colour   the cell's COLUMN, cx % 8 through eight well separated colours
         *   black squares the cell's ROW, cy + 1 of them along the centre line
         *   black L       the cell's top-left corner, so rotation is unambiguous
         *
         * Colour and counting both survive the camera; only the column is ambiguous, and only
         * modulo 8, which one look at the wall's own geometry resolves. */
        static const int CELLC[8][3] = {
            {255,0,0}, {0,255,0}, {0,0,255},    {255,255,0},
            {255,0,255}, {0,255,255}, {255,255,255}, {96,96,96}
        };
        int cellsX = w / PATTERN_CELL_W;
        int cx, cy, i;
        if (cellsX < 1) cellsX = 1;

        for (cy = 0; cy * PATTERN_CELL_H < h; cy++) {
            for (cx = 0; cx < cellsX; cx++) {
                int ox = cx * PATTERN_CELL_W, oy = cy * PATTERN_CELL_H;
                const int *c = CELLC[cx % 8];

                for (y = 0; y < PATTERN_CELL_H && oy + y < h; y++)
                    for (x = 0; x < PATTERN_CELL_W && ox + x < w; x++)
                        px(rgba, w, ox + x, oy + y, c[0], c[1], c[2]);

                /* the corner mark: two black arms meeting at the cell's top left */
                for (x = 0; x < 8 && ox + x < w; x++) px(rgba, w, ox + x, oy, 0, 0, 0);
                for (y = 0; y < 8 && oy + y < h; y++) px(rgba, w, ox, oy + y, 0, 0, 0);

                /* cy + 1 black 4x4 squares, spaced 7 apart from x = 4: eight of them still end at
                 * x = 57, inside the 64 wide cell. */
                for (i = 0; i <= cy && i < 8; i++) {
                    int bx = ox + 4 + i * 7, by = oy + PATTERN_CELL_H / 2 - 2;
                    for (y = 0; y < 4 && by + y < h; y++)
                        for (x = 0; x < 4 && bx + x < w; x++)
                            px(rgba, w, bx + x, by + y, 0, 0, 0);
                }
            }
        }
        return;
    }

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
