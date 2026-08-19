/* net.h - the listening socket, the two HTTP routes, the RFC 6455 upgrade, and the poll loop.
 *
 * One TCP port serves all of it (PROTOCOL.md §3). Several connections may exist at once — a
 * takeover has two live for a moment, and a browser probing /info while a session runs is
 * normal — but only one of them is ever the session.
 */
#ifndef HUB75_NET_H
#define HUB75_NET_H

#include "display.h"

/* Generous, because a browser opens speculative connections it may never use: Firefox preconnects
 * several sockets per origin and holds them open. A table that a handful of idle sockets can fill
 * is a table that stops answering. */
#define MAX_CLIENTS 32

/* A connection that has not finished sending a request is a preconnect or a stall, and either way
 * it is not worth a slot for long. */
#define HTTP_IDLE_SECONDS 10.0
/* An upgraded socket that never became the session — it lost a takeover, or sent no hello. */
#define WS_IDLE_SECONDS   30.0

typedef struct {
    int      inUse;
    int      fd;
    int      upgraded;
    double   acceptedAt;
    double   lastRead;
    buf      http;      /* request bytes, until the headers are complete */
    ws_conn  ws;
    display *d;
} client;

typedef struct {
    int      listenFd;
    int      dualStack;   /* 1 if IPv6 and IPv4 are both served; 0 if IPv4 only */
    display *d;
    client   c[MAX_CLIENTS];
} netserver;

int  net_start(netserver *n, display *d, int port, char *err, size_t errCap);
void net_stop(netserver *n);

/* One cycle: accept, read and dispatch everything readable, then flush. Blocks at most
 * `timeoutMs`. Draining fully before the caller draws is what gives last-write-wins for free. */
void net_poll(netserver *n, int timeoutMs);

#endif
