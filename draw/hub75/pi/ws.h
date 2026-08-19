/* ws.h - the minimum RFC 6455 the protocol needs, and nothing more.
 *
 * PROTOCOL.md §3 constrains the wire so that this file can stay small: no extensions, no
 * fragmentation, nothing over 60 KB. draw/hub75/mock/ws-server.js is the reference; this is its
 * C twin, error condition for error condition.
 */
#ifndef HUB75_WS_H
#define HUB75_WS_H

#include <stddef.h>
#include <stdint.h>

#define WS_MAX_MESSAGE (60 * 1024)

enum {
    WS_OP_CONT = 0x0, WS_OP_TEXT = 0x1, WS_OP_BINARY = 0x2,
    WS_OP_CLOSE = 0x8, WS_OP_PING = 0x9, WS_OP_PONG = 0xa
};

enum { WS_CLOSE_NORMAL = 1000, WS_CLOSE_PROTOCOL = 1002, WS_CLOSE_TOO_BIG = 1009 };

/* A grow-only byte buffer with a cheap consume-from-front. Frames are small and the leftover
 * after parsing is almost always nothing, so a memmove beats the bookkeeping of a ring. */
typedef struct {
    uint8_t *p;
    size_t   len, cap;
} buf;

int  buf_append(buf *b, const void *data, size_t n);
void buf_consume(buf *b, size_t n);
void buf_free(buf *b);

/* Sec-WebSocket-Accept for `key`. `out` needs 32 bytes. */
void ws_accept_key(const char *key, char out[32]);

typedef struct ws_conn ws_conn;

struct ws_conn {
    int  fd;
    buf  in, out;
    int  closed;      /* finished: on_close has fired, the fd is the owner's to close */
    int  closing;     /* a close frame is queued; finish once `out` drains */
    int  close_code;
    char close_reason[64];
    void *user;
    void (*on_message)(ws_conn *c, const uint8_t *data, size_t len, int binary);
    void (*on_close)(ws_conn *c, int code, const char *reason);
};

void ws_init(ws_conn *c, int fd);
void ws_dispose(ws_conn *c);

/* Feed bytes read from the socket; dispatches whole messages through on_message. */
void ws_feed(ws_conn *c, const void *data, size_t len);

int  ws_send_text(ws_conn *c, const char *s, size_t n);
int  ws_send_binary(ws_conn *c, const void *p, size_t n);
int  ws_ping(ws_conn *c);
void ws_close(ws_conn *c, int code, const char *reason);

/* Writes what it can without blocking. Returns -1 if the socket is dead. */
int  ws_flush(ws_conn *c);
int  ws_want_write(const ws_conn *c);
/* Fires on_close once a queued close frame has drained, or the socket died. */
void ws_finish(ws_conn *c, int code, const char *reason);

#endif
