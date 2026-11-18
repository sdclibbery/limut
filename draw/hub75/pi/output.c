#include "output.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ---- backends ---------------------------------------------------------------------------- */

static int write_null(output_t *o) { (void)o; return 0; }

/* `raw` keeps o->pixels, which output_frame has already filled — so there is nothing to do here
 * beyond existing. The /frame.raw route reads o->pixels directly. */
static int write_raw(output_t *o) { (void)o; return 0; }

/* ---- lifecycle --------------------------------------------------------------------------- */

/* 16-bit linear light. An 8-bit table at 2.2 sends inputs 0-14 to 0, and the card can show
 * those levels, so the curve keeps its precision until the dither in output_frame. */
static void build_gamma(output_t *o) {
    int i;
    for (i = 0; i < 256; i++) {
        double v = pow((double)i / 255.0, (double)o->gamma);
        int q = (int)(v * 65535.0 + 0.5);
        o->glut[i] = (uint16_t)(q < 0 ? 0 : q > 65535 ? 65535 : q);
    }
}

/* 4x4 ordered dither thresholds, centred in each sixteenth of the 16-bit step to 8 bits. A static
 * spatial pattern rather than a temporal one, so nothing can flicker. */
static const int BAYER4[4][4] = { {0, 8, 2, 10}, {12, 4, 14, 6}, {3, 11, 1, 9}, {15, 7, 13, 5} };

int output_open(output_t *o, const char *backend, int w, int h, float gamma, float level,
                const output_opts *opts, char *err, size_t errCap) {
    int colorlight = 0;
    memset(o, 0, sizeof *o);
    snprintf(o->backend, sizeof o->backend, "%s", backend ? backend : "null");
    o->w = w;
    o->h = h;
    o->gamma = (gamma > 0.0f) ? gamma : 1.0f;
    o->level = (level > 0.0f && level < 1.0f) ? level : 1.0f;
    o->dither = 1;
    build_gamma(o);

    if      (!strcmp(o->backend, "null"))       o->write = write_null;
    else if (!strcmp(o->backend, "raw"))        o->write = write_raw;
    else if (!strcmp(o->backend, "colorlight")) {
        o->write = output_colorlight_write;
        o->shutdown = output_colorlight_shutdown;
        colorlight = 1;
    }
    else { snprintf(err, errCap, "unknown output backend '%s'", o->backend); return -1; }

    o->pixels = (uint8_t *)calloc((size_t)w * h * 4, 1);
    if (!o->pixels) { snprintf(err, errCap, "out of memory for a %dx%d frame", w, h); return -1; }
    /* Opaque black, so a /frame.raw before the first frame is a valid image rather than zeroes
     * that read as transparent. */
    {
        size_t i, n = (size_t)w * h;
        for (i = 0; i < n; i++) o->pixels[i * 4 + 3] = 255;
    }

    /* Last, so that a backend that fails to open does so with the frame buffer already in place
     * and output_close able to free it. */
    if (colorlight && output_colorlight_open(o, opts, err, errCap) < 0) {
        free(o->pixels);
        o->pixels = NULL;
        return -1;
    }
    return 0;
}

int output_frame(output_t *o, const uint8_t *rgba, float dim) {
    int x, y, scale;

    if (dim < 0.0f) dim = 0.0f;
    if (dim > 1.0f) dim = 1.0f;
    /* dim and level scale linear light, AFTER gamma (§9). 1.8 fixed point keeps the per pixel
     * work to integer multiplies and shifts. */
    scale = (int)(dim * o->level * 256.0f + 0.5f);

    for (y = 0; y < o->h; y++) {
        for (x = 0; x < o->w; x++) {
            size_t i = (size_t)y * o->w + x;
            const uint8_t *s = rgba + i * 4;
            uint8_t *d = o->pixels + i * 4;
            /* v*255 + t over 65536: exact for 0 and full scale, and the identity at gamma 1,
             * dim 1, since every t exceeds the 255 the /65536 loses. */
            int t = o->dither ? BAYER4[y & 3][x & 3] * 4096 + 2048 : 32768;
            int c;
            for (c = 0; c < 3; c++) {
                int v = (o->glut[s[c]] * scale) >> 8;
                d[c] = (uint8_t)((v * 255 + t) >> 16);
            }
            d[3] = 255;
        }
    }
    o->frames++;
    return o->write ? o->write(o) : 0;
}

int output_resend(output_t *o) {
    if (o->frames == 0) return 0; /* nothing has ever been drawn, so there is nothing to hold */
    return o->write ? o->write(o) : 0;
}

void output_close(output_t *o) {
    if (o->shutdown) o->shutdown(o);
    free(o->pixels);
    memset(o, 0, sizeof *o);
}
