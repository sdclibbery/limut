/* output_colorlight.c - the Colorlight 5A-75B output stage: rendered pixels onto the panels.
 *
 * OFFSET CONVENTION. Colorlight puts the packet type in the FIRST byte of the ethertype field and
 * treats the SECOND byte as the first byte of data. What a sniffer shows as "ethertype 0x5500" is
 * really type 0x55, data[0] = 0x00. Offsets below are written as d[n], data-relative, where
 * d = frame + 13 — the convention the upstream reverse engineering uses, so the two can be
 * compared without an off-by-one.
 *
 * Packet types used here:
 *
 *   0x55  pixel data      d[0:1] row, d[2:3] first pixel, d[4:5] pixel count, d[6]=0x08,
 *                         d[7]=0x88, then 3 bytes per pixel. One packet per row unless the row is
 *                         wider than 497 pixels, which is where 3 bytes per pixel plus the header
 *                         reaches the 1500 byte MTU.
 *   0x01  display/sync    d[0]=0x07 (from a PC rather than a sender card), d[22] and d[25:27]
 *                         brightness, d[23]=0x05. Latches the rows just sent onto the panels.
 *   0x0A  brightness      d[0:2] brightness. Sent once at open; the sync packet carries it too.
 *
 * WHAT IS NOT DONE HERE, on current assumptions: panel mapping, because the card is flashed with
 * a receiving-card configuration describing the panel array and maps a rectangular image onto the
 * chain itself; and the dimmer and gamma, which output.c has already applied by the time write()
 * is called (PROTOCOL.md §9), so o->pixels is the final image.
 *
 * The wire format is not documented by Colorlight. It is taken from the protocol notes at the top
 * of FPP's src/channeloutput/ColorLight-5a-75.cpp, cross-checked against Harald Kubota's write-up
 * (hkubota.wordpress.com, 2022-01-31). Read for the format only — no code is taken from FPP,
 * which is GPL where limut is CC BY-SA. UNVERIFIED AGAINST HARDWARE at the time of writing; see
 * ../tools/colorlight-probe.c for the safe way to check what a card actually thinks.
 *
 * The packet building below is deliberately free of syscalls and of Linux, so it compiles and is
 * unit tested anywhere — see test_colorlight() in selftest.c. Only the sending half is
 * Linux-only, the same split render.c makes around EGL.
 */
/* sendmmsg and struct mmsghdr are behind __USE_GNU in glibc, and the Makefile's -std=gnu99 does
 * not set it — without this the daemon compiles on a Mac and fails on the Pi. */
#define _GNU_SOURCE

#include "output.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The card's fixed MAC, and the source MAC LEDVISION and FPP both use. */
static const unsigned char CARD_MAC[6] = { 0x11, 0x22, 0x33, 0x44, 0x55, 0x66 };
static const unsigned char HOST_MAC[6] = { 0x22, 0x22, 0x33, 0x44, 0x55, 0x66 };

#define TYPE_PIXEL  0x55
#define TYPE_SYNC   0x01
#define TYPE_BRIGHT 0x0A
#define DATA_OFF    13

/* ---- packet building: portable, no syscalls, unit tested ---------------------------------- */

int colorlight_order(const char *name, int idx[3]) {
    int i;
    if (!name) name = "rgb";
    if (strlen(name) != 3) return -1;
    for (i = 0; i < 3; i++) {
        switch (name[i]) {
            case 'r': case 'R': idx[i] = 0; break;
            case 'g': case 'G': idx[i] = 1; break;
            case 'b': case 'B': idx[i] = 2; break;
            default: return -1;
        }
    }
    /* Each of r, g and b exactly once, so "rrg" is rejected rather than silently dropping blue. */
    if ((idx[0] | idx[1] | idx[2]) != 3 || (idx[0] + idx[1] + idx[2]) != 3) return -1;
    return 0;
}

static void frame_head(unsigned char *out, size_t len, unsigned char type) {
    memset(out, 0, len);
    memcpy(out, CARD_MAC, 6);
    memcpy(out + 6, HOST_MAC, 6);
    out[12] = type;
}

size_t colorlight_pixel_header(unsigned char *out, int row, int pixOff, int count) {
    unsigned char *d = out + DATA_OFF;
    frame_head(out, (size_t)CL_PIXEL_HEADER, TYPE_PIXEL);
    d[0] = (unsigned char)(row >> 8);
    d[1] = (unsigned char)(row & 0xff);
    d[2] = (unsigned char)(pixOff >> 8);
    d[3] = (unsigned char)(pixOff & 0xff);
    d[4] = (unsigned char)(count >> 8);
    d[5] = (unsigned char)(count & 0xff);
    d[6] = 0x08;   /* constant, meaning unknown */
    d[7] = 0x88;   /* constant, meaning unknown */
    return (size_t)CL_PIXEL_HEADER + (size_t)count * 3;
}

void colorlight_pixels(unsigned char *pkt, int dstPixel, const uint8_t *rgba, int count,
                       const int idx[3]) {
    unsigned char *p = pkt + CL_PIXEL_HEADER + (size_t)dstPixel * 3;
    int i;
    for (i = 0; i < count; i++) {
        const uint8_t *s = rgba + (size_t)i * 4;
        p[0] = s[idx[0]];
        p[1] = s[idx[1]];
        p[2] = s[idx[2]];
        p += 3;
    }
}

size_t colorlight_sync(unsigned char *out, int brightness) {
    unsigned char *d = out + DATA_OFF;
    unsigned char b = (unsigned char)(brightness < 0 ? 0 : brightness > 255 ? 255 : brightness);
    frame_head(out, (size_t)CL_SYNC_FRAME, TYPE_SYNC);
    d[0] = 0x07;   /* sent from a PC; a sender card puts 0x00 here */
    d[22] = b;
    d[23] = 0x05;  /* constant, meaning unknown */
    d[25] = b;     /* per channel, for colour temperature */
    d[26] = b;
    d[27] = b;
    return (size_t)CL_SYNC_FRAME;
}

size_t colorlight_brightness(unsigned char *out, int brightness) {
    unsigned char *d = out + DATA_OFF;
    unsigned char b = (unsigned char)(brightness < 0 ? 0 : brightness > 255 ? 255 : brightness);
    frame_head(out, (size_t)CL_BRIGHT_FRAME, TYPE_BRIGHT);
    d[0] = b;
    d[1] = b;
    d[2] = b;
    return (size_t)CL_BRIGHT_FRAME;
}

int colorlight_packets_per_row(int width) {
    if (width <= 0) return 0;
    return (width + CL_MAX_PIXELS_PER_PACKET - 1) / CL_MAX_PIXELS_PER_PACKET;
}

/* ---- sending: Linux only ------------------------------------------------------------------ */

#ifdef __linux__

#include <errno.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <net/if.h>
#include <netinet/in.h>
#include <linux/if_packet.h>
#include <linux/if_ether.h>

typedef struct {
    int                 fd;
    struct sockaddr_ll  to;
    int                 nPkts;    /* pixel packets */
    int                 nMsgs;    /* nPkts + 1: the brightness packet leads every frame */
    size_t              stride;
    unsigned char      *buf;      /* nPkts packets, each `stride` apart, headers written once */
    int                *srcOff;   /* where in o->pixels each packet's pixels start, or -1 */
    int                *dstOff;   /* where in the packet those pixels land */
    int                *copyLen;  /* how many pixels to copy; 0 leaves the packet black */
    int                *count;    /* pixels the packet declares on the wire */
    /* Message order, fixed at open: [0] brightness, then every packet IN CANVAS ROW ORDER.
     * The order matters — see the note in ../CLAUDE.md. */
    struct mmsghdr     *msgs;
    struct iovec       *iov;
    unsigned char       sync[CL_SYNC_FRAME];
    unsigned char       bright[CL_BRIGHT_FRAME];
    int                 idx[3];
    unsigned long long  framesSent, sendErrors;
    int                 warned;
} cl_state;

static void cl_free(cl_state *s) {
    if (!s) return;
    if (s->fd >= 0) close(s->fd);
    free(s->buf); free(s->srcOff); free(s->count); free(s->msgs); free(s->iov);
    free(s->dstOff); free(s->copyLen);
    free(s);
}

/* Points message slot `m` at packet `i`'s buffer. */
static void cl_bind(cl_state *s, int m, int i) {
    s->iov[m].iov_base = s->buf + (size_t)i * s->stride;
    s->iov[m].iov_len  = (size_t)CL_PIXEL_HEADER + (size_t)s->count[i] * 3;
}

static int cl_send_one(int fd, struct sockaddr_ll *to, const void *p, size_t n) {
    for (;;) {
        ssize_t r = sendto(fd, p, n, 0, (struct sockaddr *)to, sizeof *to);
        if (r >= 0) return 0;
        if (errno == EINTR) continue;
        return -1;
    }
}

static int cl_send_batch(cl_state *s, struct mmsghdr *msgs, int total) {
    int done = 0;
    while (done < total) {
        int n = sendmmsg(s->fd, msgs + done, (unsigned)(total - done), 0);
        if (n < 0) {
            if (errno == EINTR) continue;
            s->sendErrors++;
            /* ENOBUFS is the transmit queue filling, i.e. a dropped frame, not a broken display.
             * Say so once rather than every frame at 60 Hz. */
            if (!s->warned) {
                s->warned = 1;
                fprintf(stderr, "🟡 colorlight: sendmmsg: %s (reported once)\n", strerror(errno));
            }
            return -1;
        }
        if (n == 0) break;
        done += n;
    }
    return 0;
}

int output_colorlight_open(output_t *o, const output_opts *opts, char *err, size_t errCap) {
    const char *iface = (opts && opts->iface) ? opts->iface : "eth0";
    const char *order = (opts && opts->colorOrder) ? opts->colorOrder : "rgb";
    int brightness = opts ? opts->brightness : 255;
    int rowMap = (opts && opts->rowMap > 0) ? opts->rowMap : 1;
    /* The superposition group is set by the PHYSICAL panel, not by how much we are rendering: a
     * 32 row panel with two data groups decodes 16 addresses, so canvas rows 16 apart collide. */
    int panelRows = (opts && opts->panelRows > 0) ? opts->panelRows : 32;
    int half = panelRows / 2, group = panelRows * 2;
    int cw = (opts && opts->canvasW > 0) ? opts->canvasW : o->w;
    int ch = (opts && opts->canvasH > 0) ? opts->canvasH : o->h;
    int ox = opts ? opts->offsetX : 0, oy = opts ? opts->offsetY : 0;
    int canvasH = ch * rowMap;
    int perRow = colorlight_packets_per_row(cw);
    int chunkPixels = cw < CL_MAX_PIXELS_PER_PACKET ? cw : CL_MAX_PIXELS_PER_PACKET;
    cl_state *s;
    struct ifreq ifr;
    int row, part, p, i;

    if (perRow <= 0 || o->h <= 0) { snprintf(err, errCap, "colorlight: bad size %dx%d", o->w, o->h); return -1; }
    if (ox < 0 || oy < 0 || ox + o->w > cw || oy + o->h > ch) {
        snprintf(err, errCap, "colorlight: a %dx%d render at +%d+%d does not fit a %dx%d canvas",
                 o->w, o->h, ox, oy, cw, ch);
        return -1;
    }
    if (rowMap != 1 && rowMap != 2) {
        snprintf(err, errCap, "colorlight: --row-map is 1 or 2, not %d", rowMap);
        return -1;
    }
    if (rowMap == 2 && (ch % panelRows)) {
        snprintf(err, errCap, "colorlight: --row-map 2 needs a canvas height that is a multiple "
                              "of --panel-rows %d, not %d", panelRows, ch);
        return -1;
    }

    s = (cl_state *)calloc(1, sizeof *s);
    if (!s) { snprintf(err, errCap, "colorlight: out of memory"); return -1; }
    s->fd = -1;

    if (colorlight_order(order, s->idx) < 0) {
        snprintf(err, errCap, "colorlight: '%s' is not a colour order (rgb, bgr, grb, ...)", order);
        cl_free(s);
        return -1;
    }

    s->nPkts = perRow * canvasH;
    s->nMsgs = s->nPkts + 1;
    s->stride = (size_t)CL_PIXEL_HEADER + (size_t)chunkPixels * 3;
    s->buf    = (unsigned char *)calloc((size_t)s->nPkts, s->stride);
    s->srcOff = (int *)calloc((size_t)s->nPkts, sizeof *s->srcOff);
    s->count  = (int *)calloc((size_t)s->nPkts, sizeof *s->count);
    s->dstOff = (int *)calloc((size_t)s->nPkts, sizeof *s->dstOff);
    s->copyLen= (int *)calloc((size_t)s->nPkts, sizeof *s->copyLen);
    s->msgs   = (struct mmsghdr *)calloc((size_t)s->nMsgs, sizeof *s->msgs);
    s->iov    = (struct iovec *)calloc((size_t)s->nMsgs, sizeof *s->iov);
    if (!s->buf || !s->srcOff || !s->count || !s->msgs || !s->iov || !s->dstOff || !s->copyLen) {
        snprintf(err, errCap, "colorlight: out of memory for %d packets", s->nPkts);
        cl_free(s);
        return -1;
    }

    s->fd = socket(AF_PACKET, SOCK_RAW, htons(ETH_P_ALL));
    if (s->fd < 0) {
        snprintf(err, errCap, "colorlight: socket(AF_PACKET): %s%s", strerror(errno),
                 errno == EPERM ? " — the unit grants CAP_NET_RAW; a manual run needs sudo" : "");
        cl_free(s);
        return -1;
    }

    memset(&ifr, 0, sizeof ifr);
    snprintf(ifr.ifr_name, IFNAMSIZ, "%s", iface);
    if (ioctl(s->fd, SIOCGIFINDEX, &ifr) < 0) {
        snprintf(err, errCap, "colorlight: no interface '%s': %s", iface, strerror(errno));
        cl_free(s);
        return -1;
    }
    s->to.sll_family  = AF_PACKET;
    s->to.sll_ifindex = ifr.ifr_ifindex;
    s->to.sll_halen   = 6;
    memcpy(s->to.sll_addr, CARD_MAC, 6);

    /* Headers and the scatter/gather tables are written once: per frame only the pixel bytes
     * change, which keeps the 60 Hz path to a memcpy per row and one sendmmsg.
     *
     * The brightness packet LEADS EVERY FRAME rather than being sent once at open. LEDVISION and
     * FPP both do this, and the card appears to need it: sent once, the panel showed a single
     * flash as the daemon started and then stayed dark. */
    p = 1;
    for (row = 0; row < canvasH; row++) {
        /* Which rendered row feeds this canvas row, or -1 for one that must be left black.
         *
         * With rowMap 2 the card drives twice the scan lines the panel decodes, so canvas rows
         * `half` apart superimpose. Each panel therefore eats `group` = 2 x panelRows canvas rows
         * to show panelRows physical ones. Within one group of canvas rows r:
         *
         *   r <  half                    -> the panel's upper data group, physical row r
         *   half <= r < panelRows        -> collides with the above: leave black
         *   panelRows <= r < +half       -> the lower data group, physical row half + (r - panelRows)
         *   otherwise                    -> collides: leave black
         */
        int prow = row, rrow;
        if (rowMap == 2) {
            int v = row / group, r = row % group;
            if (r < half)                                    prow = v * panelRows + r;
            else if (r >= panelRows && r < panelRows + half) prow = v * panelRows + half + (r - panelRows);
            else                                             prow = -1;
        }
        rrow = (prow < 0) ? -1 : prow - oy;
        if (rrow < 0 || rrow >= o->h) rrow = -1;

        for (part = 0; part < perRow; part++) {
            int pixOff = part * CL_MAX_PIXELS_PER_PACKET;
            int n = cw - pixOff;
            unsigned char *pkt = s->buf + (size_t)(p - 1) * s->stride;
            int xs, xe;
            if (n > CL_MAX_PIXELS_PER_PACKET) n = CL_MAX_PIXELS_PER_PACKET;

            /* Where this packet's slice of the canvas overlaps the rendered image. Packets that
             * miss it entirely keep the zeroed pixel area calloc gave them and are never touched
             * again: the header write only covers the first CL_PIXEL_HEADER bytes. */
            xs = pixOff > ox ? pixOff : ox;
            xe = (pixOff + n) < (ox + o->w) ? (pixOff + n) : (ox + o->w);
            if (rrow >= 0 && xe > xs) {
                s->dstOff[p - 1] = xs - pixOff;
                s->srcOff[p - 1] = rrow * o->w + (xs - ox);
                s->copyLen[p - 1] = xe - xs;
            } else {
                s->dstOff[p - 1] = 0;
                s->srcOff[p - 1] = -1;
                s->copyLen[p - 1] = 0;
            }
            s->count[p - 1]  = n;
            colorlight_pixel_header(pkt, row, pixOff, n);
            p++;
        }
    }

    /* Brightness first, then every packet in canvas row order, and the whole lot goes out on
     * every frame. Sending only the packets whose pixels changed, or spreading the unchanged
     * ones over several frames, is a large bandwidth saving and DOES NOT WORK on this card —
     * both were tried and both broke the picture. See ../CLAUDE.md. */
    {
        int m;
        colorlight_brightness(s->bright, brightness);
        s->iov[0].iov_base = s->bright;
        s->iov[0].iov_len  = sizeof s->bright;
        for (i = 0; i < s->nPkts; i++) cl_bind(s, i + 1, i);
        for (m = 0; m < s->nMsgs; m++) {
            s->msgs[m].msg_hdr.msg_name    = &s->to;
            s->msgs[m].msg_hdr.msg_namelen = sizeof s->to;
            s->msgs[m].msg_hdr.msg_iov     = &s->iov[m];
            s->msgs[m].msg_hdr.msg_iovlen  = 1;
        }
    }

    colorlight_sync(s->sync, brightness);

    o->state = s;
    return 0;
}

int output_colorlight_packets(const output_t *o) {
    const cl_state *s = (const cl_state *)o->state;
    return s ? s->nMsgs + 1 : 0;   /* + the sync packet */
}

int output_colorlight_write(output_t *o) {
    cl_state *s = (cl_state *)o->state;
    int i;

    if (!s) return -1;

    for (i = 0; i < s->nPkts; i++)
        if (s->copyLen[i] > 0)
            colorlight_pixels(s->buf + (size_t)i * s->stride, s->dstOff[i],
                              o->pixels + (size_t)s->srcOff[i] * 4, s->copyLen[i], s->idx);

    if (cl_send_batch(s, s->msgs, s->nMsgs) < 0) return -1;

    if (cl_send_one(s->fd, &s->to, s->sync, sizeof s->sync) < 0) {
        s->sendErrors++;
        return -1;
    }
    s->framesSent++;
    return 0;
}

void output_colorlight_shutdown(output_t *o) {
    cl_state *s = (cl_state *)o->state;
    if (!s) return;
    if (s->sendErrors)
        fprintf(stderr, "🟡 colorlight: %llu frame(s) failed to send of %llu\n",
                s->sendErrors, s->framesSent + s->sendErrors);
    cl_free(s);
    o->state = NULL;
}

#else  /* not Linux: the packet building above still compiles and is still tested */

int output_colorlight_open(output_t *o, const output_opts *opts, char *err, size_t errCap) {
    (void)o; (void)opts;
    snprintf(err, errCap,
             "the colorlight backend needs Linux — it sends raw layer 2 frames with AF_PACKET. "
             "Use --output raw here; the packet building is still unit tested by ./selftest.");
    return -1;
}

int  output_colorlight_packets(const output_t *o) { (void)o; return 0; }
int  output_colorlight_write(output_t *o) { (void)o; return -1; }
void output_colorlight_shutdown(output_t *o) { (void)o; }

#endif
