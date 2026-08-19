/* codec.h - the binary packets of PROTOCOL.md §12, decode side.
 *
 * The display only ever decodes these; encoding lives in draw/hub75/codec.js on the host. The
 * byte layout is duplicated here rather than shared, so any change to §12 has to be made in two
 * places on purpose — pi/selftest.c pins the layout against the numbers in the spec.
 */
#ifndef HUB75_CODEC_H
#define HUB75_CODEC_H

#include <stddef.h>
#include <stdint.h>

#define CODEC_PACKET_FRAME  0x01
#define CODEC_PACKET_CHUNK  0x02
#define CODEC_FRAME_HEADER  24
#define CODEC_LAYER_HEADER  4
#define CODEC_CHUNK_HEADER  4
#define CODEC_CHUNK_SIZE    16384

/* A 60 KB message cap already bounds this; the explicit limit keeps the frame struct a fixed
 * size so decoding allocates nothing on the 60 Hz path. */
#define CODEC_MAX_UNIFORMS  512

typedef struct {
    int      layerCount;
    uint32_t seq;
    float    dim;
    float    beat;
    double   hostTime;
    /* Version 1 carries at most one layer, so only the first is kept; later layers are still
     * walked, because the trailing-bytes check has to see the whole packet. */
    uint16_t layerId;
    uint16_t uniformCount;
    float    values[CODEC_MAX_UNIFORMS * 4];
} codec_frame;

/* 0 on success; -1 with *err pointing at a static reason string. */
int codec_decode_frame(const uint8_t *p, size_t n, codec_frame *out, const char **err);

int codec_decode_chunk(const uint8_t *p, size_t n, uint16_t *index,
                       const uint8_t **payload, size_t *payloadLen, const char **err);

int codec_packet_type(const uint8_t *p, size_t n);

#endif
