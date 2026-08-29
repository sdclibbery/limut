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
 *   colorlight  the real one: raw layer 2 frames to a Colorlight 5A-75B on eth0.
 */
#ifndef HUB75_OUTPUT_H
#define HUB75_OUTPUT_H

#include <stddef.h>
#include <stdint.h>

typedef struct output output_t;

/* Backend configuration. Only `colorlight` reads any of it; NULL means all defaults. */
typedef struct {
    const char *iface;       /* interface the card is cabled to (default "eth0")        */
    const char *colorOrder;  /* byte order the panels want: "rgb", "bgr", ... (default "rgb") */
    int         brightness;  /* the card's own panel brightness, 0-255 (default 255)    */
    int         rowMap;      /* 1 = rows land 1:1. 2 = the card drives twice the scan lines the
                                panel decodes, so two canvas rows superimpose on one physical
                                row; the output stage then emits a canvas of twice the height and
                                blacks out the partner of every content row. See ../CLAUDE.md. */
    int         panelRows;   /* physical rows in one panel, which sets the superposition group
                                for rowMap 2 (default 32) */
    /* The card's whole canvas, in panel space, when it is bigger than what we render: 0 means
     * "same as the render", which is the case once the card is configured for the actual wall. */
    int         canvasW, canvasH;
    /* Where the rendered image sits inside that canvas. Everything outside it is sent black. */
    int         offsetX, offsetY;
} output_opts;

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

/* `backend` is one of the names above; `opts` may be NULL. Returns 0, or -1 with a reason in
 * `err`. */
int  output_open(output_t *o, const char *backend, int w, int h, float gamma,
                 const output_opts *opts, char *err, size_t errCap);

/* Applies the dimmer and gamma to `rgba` (w*h*4, RGBA8) and hands the result to the backend. */
int  output_frame(output_t *o, const uint8_t *rgba, float dim);

void output_close(output_t *o);

/* output_colorlight.c ----------------------------------------------------------------------- */

/* 3 bytes per pixel plus the 8 byte data header reaches a 1500 byte MTU at 497 pixels, so a row
 * wider than that is split across packets. */
#define CL_MAX_PIXELS_PER_PACKET 497
#define CL_PIXEL_HEADER          21    /* 12 MAC + 1 type + 8 data header */
#define CL_SYNC_FRAME            112
#define CL_BRIGHT_FRAME          77

int  output_colorlight_open(output_t *o, const output_opts *opts, char *err, size_t errCap);

/* Packets sent per frame, for the startup line. 0 unless the colorlight backend is open. */
int  output_colorlight_packets(const output_t *o);
int  output_colorlight_write(output_t *o);
void output_colorlight_shutdown(output_t *o);

/* Packet building. No syscalls and no Linux, so these compile and are unit tested everywhere —
 * see test_colorlight() in selftest.c. Every buffer must be at least the size returned. */

/* Parses "rgb", "bgr", ... into indices into an RGBA source pixel. -1 if it is not an order. */
int    colorlight_order(const char *name, int idx[3]);

/* Writes the fixed part of a pixel packet; returns the total frame length once `count` pixels
 * have been appended by colorlight_pixels. */
size_t colorlight_pixel_header(unsigned char *out, int row, int pixOff, int count);

/* Writes `count` pixels, read as RGBA8, into a packet built by colorlight_pixel_header, starting
 * `dstPixel` pixels into its pixel area. The offset is what lets a small render be placed inside a
 * much larger canvas without the packets around it being rebuilt. */
void   colorlight_pixels(unsigned char *pkt, int dstPixel, const uint8_t *rgba, int count,
                         const int idx[3]);

size_t colorlight_sync(unsigned char *out, int brightness);
size_t colorlight_brightness(unsigned char *out, int brightness);
int    colorlight_packets_per_row(int width);

#endif
