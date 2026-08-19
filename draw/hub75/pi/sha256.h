/* sha256.h - FIPS 180-4 SHA-256. Vendored rather than linking libcrypto so the build line
 * stays as short as tools/egl-probe.c's. */
#ifndef HUB75_SHA256_H
#define HUB75_SHA256_H

#include <stddef.h>
#include <stdint.h>

typedef struct {
    uint32_t state[8];
    uint64_t bits;
    uint8_t  buf[64];
    size_t   have;
} sha256_ctx;

void sha256_init(sha256_ctx *c);
void sha256_update(sha256_ctx *c, const void *data, size_t len);
void sha256_final(sha256_ctx *c, uint8_t out[32]);

/* The protocol's content id: lowercase hex of the digest, truncated to 16 chars (PROTOCOL.md §6).
 * `out` must hold 17 bytes. Mirrors host/sha256.js. */
void sha256_id(const void *data, size_t len, char out[17]);

#endif
