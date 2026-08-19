/* display.h - all of the display's state, and the protocol state machine over it.
 *
 * session.c implements PROTOCOL.md §5, §6, §7, §8, §9, §10 and §12 against this struct;
 * net.c owns the sockets and calls in; main.c owns the loop.
 */
#ifndef HUB75_DISPLAY_H
#define HUB75_DISPLAY_H

#include "cache.h"
#include "codec.h"
#include "json.h"
#include "output.h"
#include "render.h"
#include "ws.h"

#define HUB75_PROTO   1
#define MAX_LAYER_TEX 16

typedef struct {
    int  unit;
    int  sampler;      /* 2 or 3 */
    char asset[17];
} layer_tex;

typedef struct display display;

struct display {
    /* configuration */
    char  name[64];
    int   w, h;
    int   port;
    int   verbose;
    float gamma;
    char  node[128];

    cache     cache;
    renderer *r;              /* NULL when there is no GPU; the daemon still runs */
    output_t  out;
    int       maxTextureSize; /* what /info advertises and what a lut is checked against */

    /* the one visible layer (§7.2 — version 1 has exactly one, id 0) */
    int       layerBound;
    char      layerProg[17];
    layer_tex layerTex[MAX_LAYER_TEX];
    int       nLayerTex;

    float dim;
    int   testPattern;
    int   needsRedraw;        /* a dim/test/unlayer change with no frames flowing */

    /* session (§5) — one at a time */
    ws_conn *conn;
    int      sessions;
    char     sessionId[16];
    char     clientName[64];

    /* the single asset in flight (§6.2) */
    struct {
        int      active;
        char     id[17];
        int      kind, dims, size;
        size_t   bytes;
        int      chunks, next;
        uint8_t *data;
        size_t   got;
    } pending;

    /* the latest undrawn frame; last-write-wins (§12.1) */
    int         haveFrame;
    codec_frame frame;
    long long   lastSeq;      /* -1 before the first frame of a session */

    /* telemetry (§11) */
    unsigned long long rendered, dropped, stale;
    double             renderMs;
    int                fps;
    unsigned long long fpsMark;
    double             temp;
    unsigned           throttled;
    double             throttledAt;

    uint8_t *scratch;         /* w*h*4: the rendered frame, before the output stage */
};

int  display_init(display *d, char *err, size_t errCap);
void display_free(display *d);

/* ws callbacks */
void display_on_text(display *d, ws_conn *c, const char *text, size_t n);
void display_on_binary(display *d, ws_conn *c, const uint8_t *p, size_t n);
void display_on_close(display *d, ws_conn *c);

/* Step 2 of the loop: draw the pending frame, if there is one. */
void display_draw(display *d);

/* Step 3: once a second, stat and ping. */
void display_tick(display *d, double now);

/* The /info body of §4. */
void display_info_json(display *d, strbuf *b);

/* Internal state for the /debug route. Not part of the protocol; see session.c. */
void display_debug_json(display *d, strbuf *b);

double now_seconds(void);

#endif
