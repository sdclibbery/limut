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

/* One panel of the wall: a rectangle of the RENDERED image, where it belongs in the card's
 * canvas, and the rotation between the two. This is the "pixel permutation in output.c" that
 * output.h always reserved for a card whose flashed configuration cannot express the wall — and
 * on the bench card it cannot, twice over: the panels are mounted on their sides, and the ports
 * land in canvas rows that are nowhere near each other.
 *
 * `rot` is applied going render -> canvas, so it UNDOES the mounting: a panel mounted rotated 90
 * degrees anticlockwise needs rot 90. `w` and `h` are the panel's size in the CANVAS; for rot 90
 * and 270 the region it reads from the render is h x w. */
typedef struct {
    int srcX, srcY;   /* top left of this panel's region in the rendered image  */
    int dstX, dstY;   /* top left of the panel in canvas panel space            */
    int w, h;         /* the panel's size in the canvas                         */
    int rot;          /* 0, 90, 180 or 270                                      */
} output_panel;

#define OUTPUT_MAX_PANELS 32

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
    /* Send only the canvas COLUMNS the render occupies, instead of every column of every row.
     * Every canvas row still gets a packet, in order, which is the rule the card actually
     * enforces (see ../CLAUDE.md) — only the dead columns either side are left out, using the
     * pixel packet's own offset and count fields. A wall that occupies a small part of a wide
     * canvas is then a small fraction of the bandwidth. 0 = send full width. */
    int         trimWidth;
    /* The wall, panel by panel. Empty means the whole render goes to offsetX,offsetY unrotated,
     * which is the single-panel case and the behaviour before there was a map. */
    output_panel panels[OUTPUT_MAX_PANELS];
    int          nPanels;
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

/* As colorlight_pixels, but advancing the source by `step` pixels per output pixel. Every panel
 * rotation is a constant stride through the rendered image — +/-1 along a row, +/- the render
 * width down a column — so one strided copy covers all four of them and there is no rotated
 * intermediate buffer anywhere. */
void   colorlight_pixels_step(unsigned char *pkt, int dstPixel, const uint8_t *rgba, int count,
                              int step, const int idx[3]);

/* The frame plan: which packets go out, in what order, and which pixels fill them. The row map,
 * the column window and the panel map are the subtle part of this backend and they are pure
 * geometry, so they live here rather than inside the Linux-only open() and are unit tested in
 * test_colorlight_plan(). */
typedef struct {
    int row;      /* canvas row, on the wire                */
    int pixOff;   /* first canvas column the packet carries  */
    int count;    /* columns the packet declares             */
} cl_pkt;

/* One run of pixels copied into one packet. A packet gets one segment per panel it overlaps, and
 * none at all where the canvas is black — which is most of it. */
typedef struct {
    int pkt;      /* index into the packet array                        */
    int dstOff;   /* first column WITHIN that packet                    */
    int srcOff;   /* first source pixel, as an index into the w*h render */
    int srcStep;  /* source pixels to advance per column                */
    int len;      /* columns to fill                                    */
} cl_seg;

/* Plans one frame. Packets come out in the order they must be sent — every canvas row, in canvas
 * order, which is the one thing the card actually enforces. Counts are always written, so a
 * caller can ask with both caps 0 before allocating; anything beyond a cap is counted but not
 * stored. Returns 0, or -1 with a reason in `err` if the geometry does not add up. */
int    colorlight_plan(int w, int h, const output_opts *opts,
                       cl_pkt *pkts, int pktCap, cl_seg *segs, int segCap,
                       int *nPkts, int *nSegs, char *err, size_t errCap);

size_t colorlight_sync(unsigned char *out, int brightness);
size_t colorlight_brightness(unsigned char *out, int brightness);
int    colorlight_packets_per_row(int width);

#endif
