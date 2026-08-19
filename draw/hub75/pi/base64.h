/* base64.h - encode only; the handshake is the only user. */
#ifndef HUB75_BASE64_H
#define HUB75_BASE64_H

#include <stddef.h>
#include <stdint.h>

/* Writes 4*ceil(len/3) chars plus a NUL. Caller sizes `out` accordingly. */
void base64_encode(const uint8_t *in, size_t len, char *out);

#endif
