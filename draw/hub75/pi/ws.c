#include "ws.h"
#include "sha1.h"
#include "base64.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define GUID "258EAFA5-E914-47DA-95CA-C5AB0DC85B11" /* RFC 6455 §1.3, fixed by the standard */

/* ---- buffers ----------------------------------------------------------------------------- */

int buf_append(buf *b, const void *data, size_t n) {
    if (b->len + n > b->cap) {
        size_t cap = b->cap ? b->cap : 1024;
        uint8_t *p;
        while (cap < b->len + n) cap *= 2;
        p = (uint8_t *)realloc(b->p, cap);
        if (!p) return -1;
        b->p = p;
        b->cap = cap;
    }
    memcpy(b->p + b->len, data, n);
    b->len += n;
    return 0;
}

void buf_consume(buf *b, size_t n) {
    if (n >= b->len) { b->len = 0; return; }
    memmove(b->p, b->p + n, b->len - n);
    b->len -= n;
}

void buf_free(buf *b) { free(b->p); b->p = NULL; b->len = b->cap = 0; }

/* ---- handshake --------------------------------------------------------------------------- */

void ws_accept_key(const char *key, char out[32]) {
    char joined[128];
    uint8_t digest[20];
    size_t kn = strlen(key), gn = sizeof(GUID) - 1;
    if (kn + gn >= sizeof joined) { out[0] = 0; return; }
    memcpy(joined, key, kn);
    memcpy(joined + kn, GUID, gn);
    sha1(joined, kn + gn, digest);
    base64_encode(digest, 20, out);
}

/* ---- framing ----------------------------------------------------------------------------- */

void ws_init(ws_conn *c, int fd) {
    memset(c, 0, sizeof *c);
    c->fd = fd;
}

void ws_dispose(ws_conn *c) {
    buf_free(&c->in);
    buf_free(&c->out);
}

void ws_finish(ws_conn *c, int code, const char *reason) {
    if (c->closed) return;
    c->closed = 1;
    c->close_code = code;
    snprintf(c->close_reason, sizeof c->close_reason, "%s", reason ? reason : "");
    if (c->on_close) c->on_close(c, code, c->close_reason);
}

/* Server frames are never masked (RFC 6455 §5.1). */
static int ws_frame(ws_conn *c, int opcode, const void *payload, size_t len) {
    uint8_t head[10];
    size_t hn;
    if (c->closed || c->closing) return -1;
    head[0] = (uint8_t)(0x80 | opcode); /* always FIN */
    if (len < 126) {
        head[1] = (uint8_t)len;
        hn = 2;
    } else if (len < 65536) {
        head[1] = 126;
        head[2] = (uint8_t)(len >> 8);
        head[3] = (uint8_t)len;
        hn = 4;
    } else {
        int i;
        head[1] = 127;
        for (i = 0; i < 8; i++) head[2 + i] = (uint8_t)((uint64_t)len >> (56 - i * 8));
        hn = 10;
    }
    if (buf_append(&c->out, head, hn) < 0) return -1;
    if (len && buf_append(&c->out, payload, len) < 0) return -1;
    return 0;
}

int ws_send_text(ws_conn *c, const char *s, size_t n) { return ws_frame(c, WS_OP_TEXT, s, n); }
int ws_send_binary(ws_conn *c, const void *p, size_t n) { return ws_frame(c, WS_OP_BINARY, p, n); }
int ws_ping(ws_conn *c) { return ws_frame(c, WS_OP_PING, NULL, 0); }

void ws_close(ws_conn *c, int code, const char *reason) {
    uint8_t payload[125];
    size_t rn;
    if (c->closed || c->closing) return;
    rn = reason ? strlen(reason) : 0;
    if (rn > sizeof payload - 2) rn = sizeof payload - 2;
    payload[0] = (uint8_t)(code >> 8);
    payload[1] = (uint8_t)code;
    if (rn) memcpy(payload + 2, reason, rn);
    ws_frame(c, WS_OP_CLOSE, payload, 2 + rn);
    /* Mark closing only after queueing, so ws_frame does not refuse its own close frame. */
    c->closing = 1;
    c->close_code = code;
    snprintf(c->close_reason, sizeof c->close_reason, "%s", reason ? reason : "");
}

/* A protocol violation: say why, then stop. Mirrors the mock's fail(). */
static void ws_fail(ws_conn *c, int code, const char *reason) {
    ws_close(c, code, reason);
}

void ws_feed(ws_conn *c, const void *data, size_t len) {
    if (c->closed) return;
    if (buf_append(&c->in, data, len) < 0) { ws_fail(c, WS_CLOSE_PROTOCOL, "out of memory"); return; }

    for (;;) {
        uint8_t *b = c->in.p;
        size_t avail = c->in.len, off = 2;
        int fin, rsv, opcode, masked;
        uint64_t plen;
        uint8_t *mask, *payload;
        size_t i;

        if (c->closing || c->closed) return;
        if (avail < 2) return;

        fin    = (b[0] & 0x80) != 0;
        rsv    =  b[0] & 0x70;
        opcode =  b[0] & 0x0f;
        masked = (b[1] & 0x80) != 0;
        plen   =  b[1] & 0x7f;

        if (rsv != 0) { ws_fail(c, WS_CLOSE_PROTOCOL, "reserved bits set (no extensions are negotiated)"); return; }

        if (plen == 126) {
            if (avail < off + 2) return;
            plen = ((uint64_t)b[off] << 8) | b[off + 1];
            off += 2;
        } else if (plen == 127) {
            if (avail < off + 8) return;
            plen = 0;
            for (i = 0; i < 8; i++) plen = (plen << 8) | b[off + i];
            off += 8;
            if (plen > WS_MAX_MESSAGE) { ws_fail(c, WS_CLOSE_TOO_BIG, "message too big"); return; }
        }
        if (plen > WS_MAX_MESSAGE) { ws_fail(c, WS_CLOSE_TOO_BIG, "message too big"); return; }
        /* A client frame must be masked (RFC 6455 §5.1). Browsers always mask; an unmasked frame
         * means something is wrong on the other end, not something to be lenient about. */
        if (!masked) { ws_fail(c, WS_CLOSE_PROTOCOL, "client frame not masked"); return; }
        if (avail < off + 4 + plen) return;

        mask = b + off;
        off += 4;
        payload = b + off;
        for (i = 0; i < plen; i++) payload[i] ^= mask[i & 3];
        off += (size_t)plen;

        /* PROTOCOL.md §3 forbids fragmentation precisely so neither end needs a reassembly path.
         * Checked before dispatch so a fragmented message is never half-delivered. */
        if (opcode == WS_OP_CONT || !fin) {
            ws_fail(c, WS_CLOSE_PROTOCOL, "fragmented messages are not supported");
            return;
        }

        if (opcode == WS_OP_TEXT || opcode == WS_OP_BINARY) {
            /* Dispatch BEFORE consuming. `payload` points into c->in, and buf_consume shifts the
             * remainder down over exactly that region — so consuming first hands the callback a
             * payload already overwritten by whatever followed it in the same read. That only
             * happens when two messages arrive together, which at 60 Hz is the normal case.
             * The callback may send (which touches c->out) or close, neither of which moves
             * c->in, so the pointer stays valid across the call. */
            if (c->on_message) c->on_message(c, payload, (size_t)plen, opcode == WS_OP_BINARY);
            buf_consume(&c->in, off);
            continue;
        }
        if (opcode == WS_OP_PING) {
            ws_frame(c, WS_OP_PONG, payload, (size_t)plen);
        } else if (opcode == WS_OP_PONG) {
            /* liveness only */
        } else if (opcode == WS_OP_CLOSE) {
            int code = plen >= 2 ? (payload[0] << 8) | payload[1] : WS_CLOSE_NORMAL;
            ws_frame(c, WS_OP_CLOSE, payload, plen >= 2 ? 2 : 0);
            c->closing = 1;
            c->close_code = code;
            snprintf(c->close_reason, sizeof c->close_reason, "peer closed");
            buf_consume(&c->in, off);
            return;
        } else {
            ws_fail(c, WS_CLOSE_PROTOCOL, "unknown opcode");
            return;
        }
        buf_consume(&c->in, off);
    }
}

/* ---- output ------------------------------------------------------------------------------ */

int ws_want_write(const ws_conn *c) { return c->out.len > 0; }

int ws_flush(ws_conn *c) {
    while (c->out.len > 0) {
        ssize_t n = write(c->fd, c->out.p, c->out.len);
        if (n > 0) { buf_consume(&c->out, (size_t)n); continue; }
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return 0;
        if (n < 0 && errno == EINTR) continue;
        return -1;
    }
    return 0;
}
