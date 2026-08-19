/* memmem is a GNU extension on Linux; it is in libc on both targets. */
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#include "net.h"

#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#define MAX_HEADERS 8192

/* ---- helpers ------------------------------------------------------------------------------- */

static void set_nonblocking(int fd) {
    int fl = fcntl(fd, F_GETFL, 0);
    if (fl >= 0) fcntl(fd, F_SETFL, fl | O_NONBLOCK);
}

/* Best effort, straight to the socket: these are short, one-shot HTTP responses sent before any
 * websocket exists, and the connection is closed immediately afterwards. */
static void write_all(int fd, const void *p, size_t n) {
    const char *s = (const char *)p;
    while (n > 0) {
        ssize_t w = write(fd, s, n);
        if (w > 0) { s += w; n -= (size_t)w; continue; }
        if (w < 0 && (errno == EINTR)) continue;
        if (w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            struct pollfd pf;
            pf.fd = fd;
            pf.events = POLLOUT;
            if (poll(&pf, 1, 1000) <= 0) return;
            continue;
        }
        return;
    }
}

/* Case-insensitive header lookup over the raw request. Returns the value start and length. */
static const char *header(const char *req, size_t n, const char *name, size_t *outLen) {
    size_t nameLen = strlen(name);
    const char *p = req, *end = req + n;
    while (p < end) {
        const char *eol = memchr(p, '\n', (size_t)(end - p));
        size_t lineLen = eol ? (size_t)(eol - p) : (size_t)(end - p);
        if (lineLen > nameLen && p[nameLen] == ':') {
            size_t i;
            int same = 1;
            for (i = 0; i < nameLen; i++) {
                char a = p[i], b = name[i];
                if (a >= 'A' && a <= 'Z') a = (char)(a - 'A' + 'a');
                if (b >= 'A' && b <= 'Z') b = (char)(b - 'A' + 'a');
                if (a != b) { same = 0; break; }
            }
            if (same) {
                const char *v = p + nameLen + 1;
                const char *ve = p + lineLen;
                while (v < ve && (*v == ' ' || *v == '\t')) v++;
                while (ve > v && (ve[-1] == '\r' || ve[-1] == ' ' || ve[-1] == '\t')) ve--;
                *outLen = (size_t)(ve - v);
                return v;
            }
        }
        if (!eol) break;
        p = eol + 1;
    }
    *outLen = 0;
    return NULL;
}

/* ---- HTTP routes --------------------------------------------------------------------------- */

/* Without CORS the browser's discovery probe fails with an opaque error and discovery looks
 * broken for no visible reason (PROTOCOL.md §4). */
#define CORS "Access-Control-Allow-Origin: *\r\n"

static void serve_info(client *cl) {
    strbuf b, h;
    sb_init(&b);
    sb_init(&h);
    display_info_json(cl->d, &b);
    sb_add(&b, "\n");
    sb_addf(&h, "HTTP/1.1 200 OK\r\n" CORS
                "Content-Type: application/json\r\n"
                "Cache-Control: no-store\r\n"
                "Content-Length: %zu\r\nConnection: close\r\n\r\n", b.len);
    write_all(cl->fd, h.buf, h.len);
    write_all(cl->fd, b.buf, b.len);
    sb_free(&b);
    sb_free(&h);
}

/* A debug route, deliberately NOT part of protocol v1: the last frame as it left the output
 * stage, dimmer and gamma already applied — that is, exactly what the panels would be showing.
 * Raw RGBA8 rather than an image format so there is no encoder here and no decoder in the test
 * script, and so a pixel comparison against the browser is exact. */
static void serve_frame(client *cl) {
    display *d = cl->d;
    strbuf h;
    size_t n = (size_t)d->w * d->h * 4;
    sb_init(&h);
    sb_addf(&h, "HTTP/1.1 200 OK\r\n" CORS
                "Content-Type: application/octet-stream\r\n"
                "Cache-Control: no-store\r\n"
                "X-Width: %d\r\nX-Height: %d\r\nX-Frames: %llu\r\nX-Gamma: %g\r\n"
                "Content-Length: %zu\r\nConnection: close\r\n\r\n",
            d->w, d->h, (unsigned long long)d->out.frames, (double)d->out.gamma, n);
    write_all(cl->fd, h.buf, h.len);
    write_all(cl->fd, d->out.pixels, n);
    sb_free(&h);
}

static void serve_debug(client *cl) {
    strbuf b, h;
    sb_init(&b);
    sb_init(&h);
    display_debug_json(cl->d, &b);
    sb_add(&b, "\n");
    sb_addf(&h, "HTTP/1.1 200 OK\r\n" CORS
                "Content-Type: application/json\r\n"
                "Cache-Control: no-store\r\n"
                "Content-Length: %zu\r\nConnection: close\r\n\r\n", b.len);
    write_all(cl->fd, h.buf, h.len);
    write_all(cl->fd, b.buf, b.len);
    sb_free(&b);
    sb_free(&h);
}

static void serve_404(client *cl) {
    static const char *body = "{\"error\":\"not found\"}\n";
    strbuf h;
    sb_init(&h);
    sb_addf(&h, "HTTP/1.1 404 Not Found\r\n" CORS
                "Content-Type: application/json\r\n"
                "Content-Length: %zu\r\nConnection: close\r\n\r\n", strlen(body));
    write_all(cl->fd, h.buf, h.len);
    write_all(cl->fd, body, strlen(body));
    sb_free(&h);
}

static void serve_400(client *cl) {
    static const char *r = "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n";
    write_all(cl->fd, r, strlen(r));
}

/* ---- connection lifecycle -------------------------------------------------------------------- */

static void on_ws_message(ws_conn *c, const uint8_t *data, size_t len, int binary) {
    client *cl = (client *)c->user;
    if (binary) display_on_binary(cl->d, c, data, len);
    else        display_on_text(cl->d, c, (const char *)data, len);
}

static void on_ws_close(ws_conn *c, int code, const char *reason) {
    client *cl = (client *)c->user;
    (void)code;
    (void)reason;
    display_on_close(cl->d, c);
}

static void drop_client(client *cl) {
    if (!cl->inUse) return;
    if (cl->upgraded) {
        ws_finish(&cl->ws, 1006, "socket closed");
        ws_dispose(&cl->ws);
    }
    buf_free(&cl->http);
    if (cl->fd >= 0) close(cl->fd);
    memset(cl, 0, sizeof *cl);
    cl->fd = -1;
}

static void upgrade(client *cl, const char *key, size_t keyLen) {
    char accept[32], k[128], resp[256];
    int n;
    if (keyLen == 0 || keyLen >= sizeof k) { serve_400(cl); drop_client(cl); return; }
    memcpy(k, key, keyLen);
    k[keyLen] = 0;
    ws_accept_key(k, accept);
    /* No Sec-WebSocket-Extensions in the response: §3 forbids negotiating any, permessage-deflate
     * included, so the display never has to inflate anything. */
    n = snprintf(resp, sizeof resp,
                 "HTTP/1.1 101 Switching Protocols\r\n"
                 "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                 "Sec-WebSocket-Accept: %s\r\n\r\n", accept);
    write_all(cl->fd, resp, (size_t)n);
    /* 60 Hz packets of ~100 bytes: Nagle would coalesce them into jitter. */
    { int one = 1; setsockopt(cl->fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one); }
    ws_init(&cl->ws, cl->fd);
    cl->ws.user = cl;
    cl->ws.on_message = on_ws_message;
    cl->ws.on_close = on_ws_close;
    cl->upgraded = 1;
}

/* Returns 1 once the request has been dealt with and the client is finished with. */
static int handle_http(client *cl) {
    const char *req = (const char *)cl->http.p;
    size_t n = cl->http.len, pathLen;
    const char *headEnd, *path, *sp;

    if (n > MAX_HEADERS) { serve_400(cl); return 1; }
    headEnd = (const char *)memmem(req, n, "\r\n\r\n", 4);
    if (!headEnd) return 0; /* keep accumulating */

    if (n < 5 || memcmp(req, "GET ", 4) != 0) { serve_400(cl); return 1; }
    path = req + 4;
    sp = (const char *)memchr(path, ' ', (size_t)(headEnd - path));
    if (!sp) { serve_400(cl); return 1; }
    pathLen = (size_t)(sp - path);
    { /* a query string is not part of the route */
        const char *q = (const char *)memchr(path, '?', pathLen);
        if (q) pathLen = (size_t)(q - path);
    }

    if (pathLen == 5 && !memcmp(path, "/info", 5)) { serve_info(cl); return 1; }
    if (pathLen == 10 && !memcmp(path, "/frame.raw", 10)) { serve_frame(cl); return 1; }
    if (pathLen == 6 && !memcmp(path, "/debug", 6)) { serve_debug(cl); return 1; }
    if (pathLen == 8 && !memcmp(path, "/session", 8)) {
        size_t upLen = 0, keyLen = 0;
        const char *up = header(req, (size_t)(headEnd - req), "upgrade", &upLen);
        const char *key = header(req, (size_t)(headEnd - req), "sec-websocket-key", &keyLen);
        if (!up || upLen != 9 || (up[0] != 'w' && up[0] != 'W') || !key) {
            serve_400(cl);
            return 1;
        }
        upgrade(cl, key, keyLen);
        {   /* Bytes after the headers belong to the websocket stream already. */
            size_t used = (size_t)(headEnd - req) + 4;
            if (cl->upgraded && cl->http.len > used)
                ws_feed(&cl->ws, cl->http.p + used, cl->http.len - used);
        }
        buf_free(&cl->http);
        return 0;
    }
    serve_404(cl);
    return 1;
}

/* ---- server -------------------------------------------------------------------------------- */

int net_start(netserver *n, display *d, int port, char *err, size_t errCap) {
    struct sockaddr_in addr;
    int one = 1, i;

    memset(n, 0, sizeof *n);
    n->d = d;
    for (i = 0; i < MAX_CLIENTS; i++) n->c[i].fd = -1;

    n->listenFd = socket(AF_INET, SOCK_STREAM, 0);
    if (n->listenFd < 0) { snprintf(err, errCap, "socket: %s", strerror(errno)); return -1; }
    setsockopt(n->listenFd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    memset(&addr, 0, sizeof addr);
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons((uint16_t)port);
    if (bind(n->listenFd, (struct sockaddr *)&addr, sizeof addr) < 0) {
        snprintf(err, errCap, "bind port %d: %s", port, strerror(errno));
        close(n->listenFd);
        n->listenFd = -1;
        return -1;
    }
    if (listen(n->listenFd, 8) < 0) {
        snprintf(err, errCap, "listen: %s", strerror(errno));
        close(n->listenFd);
        n->listenFd = -1;
        return -1;
    }
    set_nonblocking(n->listenFd);
    return 0;
}

void net_stop(netserver *n) {
    int i;
    for (i = 0; i < MAX_CLIENTS; i++) drop_client(&n->c[i]);
    if (n->listenFd >= 0) close(n->listenFd);
    n->listenFd = -1;
}

static void accept_new(netserver *n) {
    for (;;) {
        int fd = accept(n->listenFd, NULL, NULL), i;
        if (fd < 0) return;
        for (i = 0; i < MAX_CLIENTS; i++) if (!n->c[i].inUse) break;
        if (i == MAX_CLIENTS) { close(fd); continue; } /* nothing sane to do but refuse */
        set_nonblocking(fd);
        memset(&n->c[i], 0, sizeof n->c[i]);
        n->c[i].inUse = 1;
        n->c[i].fd = fd;
        n->c[i].d = n->d;
    }
}

static void read_client(client *cl) {
    for (;;) {
        uint8_t chunk[16384];
        ssize_t r = read(cl->fd, chunk, sizeof chunk);
        if (r > 0) {
            if (cl->upgraded) {
                ws_feed(&cl->ws, chunk, (size_t)r);
                if (cl->ws.closing || cl->ws.closed) return;
            } else {
                if (buf_append(&cl->http, chunk, (size_t)r) < 0) { drop_client(cl); return; }
                if (handle_http(cl)) { drop_client(cl); return; }
            }
            continue;
        }
        if (r == 0) { drop_client(cl); return; }             /* peer closed */
        if (errno == EINTR) continue;
        if (errno == EAGAIN || errno == EWOULDBLOCK) return; /* drained */
        drop_client(cl);
        return;
    }
}

void net_poll(netserver *n, int timeoutMs) {
    struct pollfd pf[MAX_CLIENTS + 1];
    int idx[MAX_CLIENTS + 1];
    int nfds = 0, i;

    pf[nfds].fd = n->listenFd;
    pf[nfds].events = POLLIN;
    idx[nfds] = -1;
    nfds++;
    for (i = 0; i < MAX_CLIENTS; i++) {
        if (!n->c[i].inUse) continue;
        pf[nfds].fd = n->c[i].fd;
        pf[nfds].events = POLLIN | (n->c[i].upgraded && ws_want_write(&n->c[i].ws) ? POLLOUT : 0);
        pf[nfds].revents = 0;
        idx[nfds] = i;
        nfds++;
    }
    if (poll(pf, (nfds_t)nfds, timeoutMs) < 0) return;

    if (pf[0].revents & POLLIN) accept_new(n);
    for (i = 1; i < nfds; i++) {
        client *cl = &n->c[idx[i]];
        if (!cl->inUse) continue;
        if (pf[i].revents & (POLLIN | POLLHUP | POLLERR)) read_client(cl);
    }
    /* Flush after dispatching, so replies produced by this cycle's messages go out in it. */
    for (i = 0; i < MAX_CLIENTS; i++) {
        client *cl = &n->c[i];
        if (!cl->inUse || !cl->upgraded) continue;
        if (ws_flush(&cl->ws) < 0) { drop_client(cl); continue; }
        /* A queued close frame has to reach the wire before the socket goes: a host that never
         * sees `closed` cannot tell a takeover from a crash. */
        if (cl->ws.closing && !ws_want_write(&cl->ws)) {
            ws_finish(&cl->ws, cl->ws.close_code, cl->ws.close_reason);
            drop_client(cl);
        }
    }
}
