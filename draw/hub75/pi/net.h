/* net.h - the listening socket, the two HTTP routes, the RFC 6455 upgrade, and the poll loop.
 *
 * One TCP port serves all of it (PROTOCOL.md §3). Several connections may exist at once — a
 * takeover has two live for a moment, and a browser probing /info while a session runs is
 * normal — but only one of them is ever the session.
 */
#ifndef HUB75_NET_H
#define HUB75_NET_H

#include "display.h"

#define MAX_CLIENTS 8

typedef struct {
    int      inUse;
    int      fd;
    int      upgraded;
    buf      http;      /* request bytes, until the headers are complete */
    ws_conn  ws;
    display *d;
} client;

typedef struct {
    int      listenFd;
    display *d;
    client   c[MAX_CLIENTS];
} netserver;

int  net_start(netserver *n, display *d, int port, char *err, size_t errCap);
void net_stop(netserver *n);

/* One cycle: accept, read and dispatch everything readable, then flush. Blocks at most
 * `timeoutMs`. Draining fully before the caller draws is what gives last-write-wins for free. */
void net_poll(netserver *n, int timeoutMs);

#endif
