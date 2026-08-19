/* sha1.h - SHA-1, needed only for the RFC 6455 Sec-WebSocket-Accept handshake. */
#ifndef HUB75_SHA1_H
#define HUB75_SHA1_H

#include <stddef.h>
#include <stdint.h>

void sha1(const void *data, size_t len, uint8_t out[20]);

#endif
