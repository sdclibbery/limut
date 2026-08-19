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

static void build_gamma(output_t *o) {
    int i;
    for (i = 0; i < 256; i++) {
        double v = pow((double)i / 255.0, (double)o->gamma);
        int q = (int)(v * 255.0 + 0.5);
        o->glut[i] = (uint8_t)(q < 0 ? 0 : q > 255 ? 255 : q);
    }
}

int output_open(output_t *o, const char *backend, int w, int h, float gamma,
                char *err, size_t errCap) {
    memset(o, 0, sizeof *o);
    snprintf(o->backend, sizeof o->backend, "%s", backend ? backend : "null");
    o->w = w;
    o->h = h;
    o->gamma = (gamma > 0.0f) ? gamma : 1.0f;
    build_gamma(o);

    if      (!strcmp(o->backend, "null"))       o->write = write_null;
    else if (!strcmp(o->backend, "raw"))        o->write = write_raw;
    else if (!strcmp(o->backend, "colorlight")) {
        o->write = output_colorlight_write;
        o->shutdown = output_colorlight_shutdown;
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
    return 0;
}

int output_frame(output_t *o, const uint8_t *rgba, float dim) {
    size_t i, n = (size_t)o->w * o->h;
    int scale;

    if (dim < 0.0f) dim = 0.0f;
    if (dim > 1.0f) dim = 1.0f;
    /* 8.8 fixed point: the dimmer multiply runs over every pixel of every frame, and this keeps
     * it to a multiply and a shift rather than a float round trip. */
    scale = (int)(dim * 256.0f + 0.5f);

    for (i = 0; i < n; i++) {
        const uint8_t *s = rgba + i * 4;
        uint8_t *d = o->pixels + i * 4;
        int r = (s[0] * scale) >> 8;
        int g = (s[1] * scale) >> 8;
        int b = (s[2] * scale) >> 8;
        /* dim is linear and applied BEFORE gamma (§9) */
        d[0] = o->glut[r > 255 ? 255 : r];
        d[1] = o->glut[g > 255 ? 255 : g];
        d[2] = o->glut[b > 255 ? 255 : b];
        d[3] = 255;
    }
    o->frames++;
    return o->write ? o->write(o) : 0;
}

void output_close(output_t *o) {
    if (o->shutdown) o->shutdown(o);
    free(o->pixels);
    memset(o, 0, sizeof *o);
}
