#include "codec.h"
#include <string.h>

/* All multi-byte fields are little-endian (§12), assembled byte by byte rather than cast, so the
 * layout is stated in the code and does not depend on the host's endianness. */
static uint16_t rd_u16(const uint8_t *p) { return (uint16_t)(p[0] | ((uint16_t)p[1] << 8)); }

static uint32_t rd_u32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static float rd_f32(const uint8_t *p) {
    uint32_t v = rd_u32(p);
    float f;
    memcpy(&f, &v, 4);
    return f;
}

static double rd_f64(const uint8_t *p) {
    uint64_t v = 0;
    double d;
    int i;
    for (i = 7; i >= 0; i--) v = (v << 8) | p[i];
    memcpy(&d, &v, 8);
    return d;
}

int codec_packet_type(const uint8_t *p, size_t n) { return n > 0 ? p[0] : -1; }

int codec_decode_frame(const uint8_t *p, size_t n, codec_frame *out, const char **err) {
    size_t off = CODEC_FRAME_HEADER;
    int i;

    if (n < CODEC_FRAME_HEADER) { *err = "frame packet truncated"; return -1; }
    if (p[0] != CODEC_PACKET_FRAME) { *err = "not a frame packet"; return -1; }
    if (rd_u16(p + 2) != 0) { *err = "frame flags must be zero in proto 1"; return -1; }

    memset(out, 0, sizeof *out);
    out->layerCount = p[1];
    out->seq        = rd_u32(p + 4);
    out->dim        = rd_f32(p + 8);
    out->beat       = rd_f32(p + 12);
    out->hostTime   = rd_f64(p + 16);

    for (i = 0; i < out->layerCount; i++) {
        uint16_t id, count;
        if (off + CODEC_LAYER_HEADER > n) { *err = "frame packet truncated in layer header"; return -1; }
        id    = rd_u16(p + off);
        count = rd_u16(p + off + 2);
        off += CODEC_LAYER_HEADER;
        if (count > CODEC_MAX_UNIFORMS) { *err = "frame packet declares too many uniforms"; return -1; }
        if (off + (size_t)count * 16 > n) { *err = "frame packet truncated in uniforms"; return -1; }
        if (i == 0) {
            int j;
            out->layerId = id;
            out->uniformCount = count;
            for (j = 0; j < count * 4; j++) out->values[j] = rd_f32(p + off + (size_t)j * 4);
        }
        off += (size_t)count * 16;
    }
    if (off != n) { *err = "frame packet has trailing bytes"; return -1; }
    return 0;
}

int codec_decode_chunk(const uint8_t *p, size_t n, uint16_t *index,
                       const uint8_t **payload, size_t *payloadLen, const char **err) {
    if (n < CODEC_CHUNK_HEADER) { *err = "chunk packet truncated"; return -1; }
    if (p[0] != CODEC_PACKET_CHUNK) { *err = "not a chunk packet"; return -1; }
    if (p[1] != 0) { *err = "chunk reserved byte must be zero"; return -1; }
    *index = rd_u16(p + 2);
    *payload = p + CODEC_CHUNK_HEADER;
    *payloadLen = n - CODEC_CHUNK_HEADER;
    if (*payloadLen > CODEC_CHUNK_SIZE) { *err = "chunk payload too big"; return -1; }
    return 0;
}
