#include "sha1.h"
#include <string.h>

#define ROL(x, n) (((x) << (n)) | ((x) >> (32 - (n))))

static void block(uint32_t state[5], const uint8_t *p) {
    uint32_t w[80], a, b, c, d, e;
    int i;
    for (i = 0; i < 16; i++)
        w[i] = ((uint32_t)p[i*4] << 24) | ((uint32_t)p[i*4+1] << 16) |
               ((uint32_t)p[i*4+2] << 8) | (uint32_t)p[i*4+3];
    for (; i < 80; i++) w[i] = ROL(w[i-3] ^ w[i-8] ^ w[i-14] ^ w[i-16], 1);
    a = state[0]; b = state[1]; c = state[2]; d = state[3]; e = state[4];
    for (i = 0; i < 80; i++) {
        uint32_t f, k;
        if (i < 20)      { f = (b & c) | ((~b) & d);          k = 0x5a827999u; }
        else if (i < 40) { f = b ^ c ^ d;                     k = 0x6ed9eba1u; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d);   k = 0x8f1bbcdcu; }
        else             { f = b ^ c ^ d;                     k = 0xca62c1d6u; }
        uint32_t t = ROL(a, 5) + f + e + k + w[i];
        e = d; d = c; c = ROL(b, 30); b = a; a = t;
    }
    state[0] += a; state[1] += b; state[2] += c; state[3] += d; state[4] += e;
}

/* One-shot: the only input this ever sees is a websocket key plus the RFC GUID, 60 bytes. */
void sha1(const void *data, size_t len, uint8_t out[20]) {
    uint32_t state[5] = { 0x67452301u, 0xefcdab89u, 0x98badcfeu, 0x10325476u, 0xc3d2e1f0u };
    const uint8_t *p = (const uint8_t *)data;
    uint64_t bits = (uint64_t)len * 8;
    uint8_t tail[128];
    size_t whole = len / 64, rest = len % 64, tailLen;
    size_t i;
    for (i = 0; i < whole; i++) block(state, p + i * 64);
    memcpy(tail, p + whole * 64, rest);
    tail[rest] = 0x80;
    tailLen = (rest < 56) ? 64 : 128;
    memset(tail + rest + 1, 0, tailLen - rest - 1 - 8);
    for (i = 0; i < 8; i++) tail[tailLen - 8 + i] = (uint8_t)(bits >> (56 - i * 8));
    for (i = 0; i < tailLen / 64; i++) block(state, tail + i * 64);
    for (i = 0; i < 5; i++) {
        out[i*4+0] = (uint8_t)(state[i] >> 24);
        out[i*4+1] = (uint8_t)(state[i] >> 16);
        out[i*4+2] = (uint8_t)(state[i] >> 8);
        out[i*4+3] = (uint8_t)(state[i]);
    }
}
