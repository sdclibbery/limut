/* selftest.c - unit tests for the parts of the display that need no GPU and no network.
 *
 *   make selftest && ./selftest
 *
 * Deliberately covers the byte layouts and text checks rather than the plumbing: the plumbing is
 * covered end to end by mock/selftest.js and mock/host-check.js driven against a running daemon,
 * which is a far better test of it than anything that could be written here.
 */
#include "base64.h"
#include "codec.h"
#include "glsl.h"
#include "json.h"
#include "output.h"
#include "pacing.h"
#include "sha1.h"
#include "sha256.h"
#include "ws.h"

#include <stdio.h>
#include <stdlib.h>
#include "patterns.h"
#include <string.h>

static int failures = 0, checks = 0;

static void ck(const char *what, int ok) {
    checks++;
    if (!ok) { printf("  [FAIL] %s\n", what); failures++; }
}

/* A shader in exactly the shape draw/visualsynth/codegen.js emits (see its buildSource). */
static const char *SHADER =
    "#version 300 es\n"
    "precision highp float;\n"
    "precision highp sampler3D;\n"
    "in vec2 fragCoord;\n"
    "out vec4 fragColor;\n"
    "uniform vec4 u_vs0;\n"
    "uniform vec4 u_vs1;\n"
    "uniform sampler3D u_vstex0;\n"
    "uniform vec2 u_vsex0;\n"
    "void main() {\n"
    "  vec4 v0 = vec4(fragCoord, 0.0, 1.0);\n"
    "  vec4 v1 = v0 * u_vs0;\n"
    "  vec4 v2 = v1 + u_vs1;\n"
    "  vec4 v3 = texture(u_vstex0, (v2).xyz);\n"
    "  fragColor = v3;\n"
    "}\n";

static void test_hashes(void) {
    char id[17];
    uint8_t d[20];
    char b64[64];

    sha256_id("abc", 3, id);
    ck("sha256('abc') content id", !strcmp(id, "ba7816bf8f01cfea"));
    sha256_id("", 0, id);
    ck("sha256('') content id", !strcmp(id, "e3b0c44298fc1c14"));
    {   /* longer than one block, to exercise the update/final split */
        char big[1000];
        memset(big, 'a', sizeof big);
        sha256_id(big, sizeof big, id);
        ck("sha256 of 1000 'a's", !strcmp(id, "41edece42d63e8d9"));
    }
    /* The one SHA-1 input that matters: RFC 6455 §1.3's worked example. */
    sha1("dGhlIHNhbXBsZSBub25jZQ==258EAFA5-E914-47DA-95CA-C5AB0DC85B11", 60, d);
    base64_encode(d, 20, b64);
    ck("RFC 6455 accept key", !strcmp(b64, "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));
    ws_accept_key("dGhlIHNhbXBsZSBub25jZQ==", b64);
    ck("ws_accept_key agrees", !strcmp(b64, "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));

    base64_encode((const uint8_t *)"f", 1, b64);   ck("base64 1 byte", !strcmp(b64, "Zg=="));
    base64_encode((const uint8_t *)"fo", 2, b64);  ck("base64 2 bytes", !strcmp(b64, "Zm8="));
    base64_encode((const uint8_t *)"foo", 3, b64); ck("base64 3 bytes", !strcmp(b64, "Zm9v"));
}

static void test_json(void) {
    static const char *s =
        "{\"type\":\"layer\",\"id\":0,\"prog\":\"9c4e\",\"go\":true,"
        "\"textures\":[{\"unit\":0,\"sampler\":\"sampler3D\",\"asset\":\"3f9a\"}],"
        "\"frag\":\"a\\nb\\u00e9\",\"neg\":-1.5}";
    js_tok t[64];
    int n = js_parse(s, strlen(s), t, 64), tex, e0;
    char buf[64];

    ck("parses a layer message", n > 0);
    ck("type", js_streq(s, t, js_get(s, t, n, 0, "type"), "layer"));
    ck("id", js_num(s, t, js_get(s, t, n, 0, "id"), -1) == 0);
    ck("negative fractions", js_num(s, t, js_get(s, t, n, 0, "neg"), 0) == -1.5);
    ck("booleans", js_bool(t, js_get(s, t, n, 0, "go"), 0) == 1);
    tex = js_get(s, t, n, 0, "textures");
    ck("textures is a one element array", tex >= 0 && t[tex].type == JS_ARR && t[tex].size == 1);
    e0 = js_at(t, n, tex, 0);
    ck("nested object lookup", js_streq(s, t, js_get(s, t, n, e0, "sampler"), "sampler3D"));
    ck("array bounds", js_at(t, n, tex, 1) == -1);
    ck("unescapes \\n and \\uXXXX",
       js_str(s, t, js_get(s, t, n, 0, "frag"), buf, sizeof buf) == 5 &&
       !memcmp(buf, "a\nb\xc3\xa9", 5));
    ck("absent key reads as -1", js_get(s, t, n, 0, "nope") == -1);
    ck("a truncated string does not overrun", js_str(s, t, js_get(s, t, n, 0, "frag"), buf, 3) == -1);

    ck("malformed: missing value", js_parse("{\"a\":}", 6, t, 64) < 0);
    ck("malformed: truncated", js_parse("{\"a\":1", 6, t, 64) < 0);
    ck("malformed: unterminated string", js_parse("{\"a\":\"x", 7, t, 64) < 0);
    ck("malformed: stray closer", js_parse("{\"a\":1}}", 8, t, 64) < 0);
    ck("malformed: non-string key", js_parse("{1:2}", 5, t, 64) < 0);
    ck("token budget exhausted reports -2", js_parse(s, strlen(s), t, 3) == -2);

    {   /* Emission has to survive a driver log full of quotes and newlines. */
        strbuf b;
        sb_init(&b);
        sb_add(&b, "{\"log\":");
        sb_json_str(&b, "0:14: 'foo'\n\"x\"\t\001", 17);
        sb_add(&b, ",\"v\":");
        sb_json_num(&b, 0.5);
        sb_add(&b, ",\"n\":");
        sb_json_num(&b, 60);
        sb_add(&b, "}");
        ck("emitted JSON escapes control characters",
           !strcmp(b.buf, "{\"log\":\"0:14: 'foo'\\n\\\"x\\\"\\t\\u0001\",\"v\":0.5,\"n\":60}"));
        {   /* and must round trip back through the parser */
            int m = js_parse(b.buf, b.len, t, 64);
            char out[64];
            ck("emitted JSON re-parses", m > 0);
            ck("escaped log survives the round trip",
               js_str(b.buf, t, js_get(b.buf, t, m, 0, "log"), out, sizeof out) == 17 &&
               !memcmp(out, "0:14: 'foo'\n\"x\"\t\001", 17));
        }
        sb_reset(&b);
        sb_json_num(&b, 0.0 / 1.0);
        ck("zero emits as 0", !strcmp(b.buf, "0"));
        sb_free(&b);
    }
}

/* §12.1: one layer with four uniforms is 92 bytes. Building the packet by hand here is the point
 * — it pins this decoder against the numbers in the spec rather than against codec.js. */
static void test_codec(void) {
    uint8_t p[92];
    codec_frame f;
    const char *err = NULL;
    int i;

    memset(p, 0, sizeof p);
    p[0] = 0x01;      /* packetType */
    p[1] = 1;         /* layerCount */
    p[2] = p[3] = 0;  /* flags */
    p[4] = 0x2a;      /* seq = 42 */
    /* dim = 0.5 -> 0x3f000000, little-endian */
    p[8] = 0x00; p[9] = 0x00; p[10] = 0x00; p[11] = 0x3f;
    /* beat = 1.0 -> 0x3f800000 */
    p[12] = 0x00; p[13] = 0x00; p[14] = 0x80; p[15] = 0x3f;
    /* hostTime = 2.0 -> 0x4000000000000000 */
    p[23] = 0x40;
    p[24] = 0; p[25] = 0;   /* layerId 0 */
    p[26] = 4; p[27] = 0;   /* uniformCount 4 */
    for (i = 0; i < 16; i++) { /* 16 floats, each 1.0 */
        p[28 + i * 4 + 2] = 0x80;
        p[28 + i * 4 + 3] = 0x3f;
    }
    ck("a one layer four uniform packet is 92 bytes",
       CODEC_FRAME_HEADER + CODEC_LAYER_HEADER + 4 * 16 == 92);
    ck("decodes", codec_decode_frame(p, sizeof p, &f, &err) == 0);
    ck("seq", f.seq == 42);
    ck("dim", f.dim == 0.5f);
    ck("beat", f.beat == 1.0f);
    ck("hostTime", f.hostTime == 2.0);
    ck("layerCount", f.layerCount == 1);
    ck("uniformCount", f.uniformCount == 4);
    ck("uniform values", f.values[0] == 1.0f && f.values[15] == 1.0f);

    ck("trailing bytes rejected", codec_decode_frame(p, sizeof p - 1, &f, &err) == -1);
    p[2] = 1;
    ck("non-zero flags rejected", codec_decode_frame(p, sizeof p, &f, &err) == -1);
    p[2] = 0;
    p[1] = 2;
    ck("a second layer that is not there is a truncation",
       codec_decode_frame(p, sizeof p, &f, &err) == -1);
    p[1] = 0;
    ck("layerCount 0 with no layer body is legal (the host sends it when nothing is drawing)",
       codec_decode_frame(p, CODEC_FRAME_HEADER, &f, &err) == 0);
    p[0] = 0x02;
    ck("a chunk is not a frame", codec_decode_frame(p, CODEC_FRAME_HEADER, &f, &err) == -1);

    {
        uint8_t c[4 + 5] = { 0x02, 0, 0x07, 0x00, 'h', 'e', 'l', 'l', 'o' };
        uint16_t idx;
        const uint8_t *pay;
        size_t plen;
        ck("chunk decodes", codec_decode_chunk(c, sizeof c, &idx, &pay, &plen, &err) == 0);
        ck("chunk index is little-endian", idx == 7);
        ck("chunk payload", plen == 5 && !memcmp(pay, "hello", 5));
        c[1] = 1;
        ck("chunk reserved byte must be zero",
           codec_decode_chunk(c, sizeof c, &idx, &pay, &plen, &err) == -1);
    }
}

static void test_glsl(void) {
    char names[GLSL_MAX_UNIFORMS][32];
    char *want[4];
    char err[1024];
    int kinds[GLSL_MAX_TEXTURES], n;

    n = glsl_declared_uniforms(SHADER, names, GLSL_MAX_UNIFORMS);
    ck("finds both vec4 uniforms and skips u_vsex0", n == 2);
    ck("in source order", !strcmp(names[0], "u_vs0") && !strcmp(names[1], "u_vs1"));

    n = glsl_declared_samplers(SHADER, kinds, GLSL_MAX_TEXTURES);
    ck("finds the sampler unit", n == 1 && kinds[0] == 3);

    want[0] = "u_vs0"; want[1] = "u_vs1";
    ck("a well formed shader with a matching list passes",
       glsl_check_program(SHADER, want, 2, err, sizeof err) == 0);

    /* The check this file exists for: uniform slots are positional on the wire (§7.1), so a
     * declared list disagreeing with the source is a silent wrong-picture bug. */
    want[1] = "u_vs2";
    ck("a mismatched uniform list is rejected",
       glsl_check_program(SHADER, want, 2, err, sizeof err) == -1);
    ck("and the message names both lists", strstr(err, "u_vs2") && strstr(err, "u_vs1"));
    want[1] = "u_vs1";
    ck("a short uniform list is rejected",
       glsl_check_program(SHADER, want, 1, err, sizeof err) == -1);

    ck("a missing #version is rejected",
       glsl_check_program("precision highp float;\nvoid main(){}\n", want, 0, err, sizeof err) == -1);
    ck("and says so", strstr(err, "#version 300 es") != NULL);
    ck("several problems are reported together",
       glsl_check_program("nope\n", want, 0, err, sizeof err) == -1 && strchr(err, '\n') != NULL);

    {
        int bound[2];
        bound[0] = 3;
        ck("matching sampler kinds pass", glsl_check_textures(SHADER, bound, 1, err, sizeof err) == 0);
        bound[0] = 2;
        ck("a sampler2D bound where the shader wants sampler3D is rejected",
           glsl_check_textures(SHADER, bound, 1, err, sizeof err) == -1);
        bound[0] = 3; bound[1] = 2;
        ck("binding more units than the shader declares is rejected",
           glsl_check_textures(SHADER, bound, 2, err, sizeof err) == -1);
        ck("binding none when one is declared is rejected",
           glsl_check_textures(SHADER, bound, 0, err, sizeof err) == -1);
    }
    /* Whitespace between the tokens is legal GLSL and must not fool the scanner. */
    ck("tolerates odd whitespace",
       glsl_declared_uniforms("uniform\n vec4\tu_vs0 ;\n", names, 8) == 1);
    /* u_vsex0 is a vec2, not a slot, and must never be counted. */
    ck("ignores vec2 extents uniforms",
       glsl_declared_uniforms("uniform vec2 u_vsex0;\nuniform vec4 u_vs0;\n", names, 8) == 1);
    /* A name that merely starts with u_vs is not a slot. */
    ck("ignores lookalike names",
       glsl_declared_uniforms("uniform vec4 u_vsX;\n", names, 8) == 0);
}

/* Feeds a client-masked frame in, the way a browser would send it. */
static void feed_masked(ws_conn *c, int opcode, const char *payload, size_t n) {
    uint8_t head[8];
    uint8_t mask[4] = { 0x11, 0x22, 0x33, 0x44 };
    uint8_t *body = (uint8_t *)malloc(n ? n : 1);
    size_t hn = 2, i;
    head[0] = (uint8_t)(0x80 | opcode);
    if (n < 126) {
        head[1] = (uint8_t)(0x80 | n);
    } else {
        head[1] = 0x80 | 126;
        head[2] = (uint8_t)(n >> 8);
        head[3] = (uint8_t)n;
        hn = 4;
    }
    memcpy(head + hn, mask, 4);
    hn += 4;
    for (i = 0; i < n; i++) body[i] = (uint8_t)(payload[i] ^ mask[i & 3]);
    ws_feed(c, head, hn);
    ws_feed(c, body, n);
    free(body);
}

static char got_msg[256];
static size_t got_len;
static int got_binary, got_count;

static char record[4][8];
static int recorded;

static void record_msg(ws_conn *c, const uint8_t *d, size_t n, int binary) {
    (void)c;
    (void)binary;
    if (recorded < 4) memcpy(record[recorded], d, n < 8 ? n : 8);
    recorded++;
}

static void on_msg(ws_conn *c, const uint8_t *d, size_t n, int binary) {
    (void)c;
    got_len = n < sizeof got_msg ? n : sizeof got_msg;
    memcpy(got_msg, d, got_len);
    got_binary = binary;
    got_count++;
}

static void test_ws(void) {
    ws_conn c;
    /* fd -1: nothing is ever flushed, so the output buffer is the assertion surface. */
    ws_init(&c, -1);
    c.on_message = on_msg;

    got_count = 0;
    feed_masked(&c, WS_OP_TEXT, "{\"type\":\"hello\"}", 16);
    ck("unmasks a text frame", got_count == 1 && got_len == 16 && !got_binary &&
                               !memcmp(got_msg, "{\"type\":\"hello\"}", 16));

    feed_masked(&c, WS_OP_BINARY, "\x01\x00", 2);
    ck("binary frames are flagged", got_count == 2 && got_binary && got_len == 2);

    /* Two frames arriving in one read must both be delivered — this is the normal case at 60 Hz
     * with TCP coalescing a chunk and a frame packet together. */
    got_count = 0;
    {
        ws_conn d;
        ws_init(&d, -1);
        d.on_message = on_msg;
        feed_masked(&d, WS_OP_TEXT, "ab", 2);
        feed_masked(&d, WS_OP_TEXT, "cd", 2);
        ck("two frames in sequence both arrive", got_count == 2 && !memcmp(got_msg, "cd", 2));
        ws_dispose(&d);
    }

    /* Two messages in ONE read: the FIRST payload must survive being dispatched, even though
     * the buffer still holds the second behind it. Getting this wrong corrupts the first message
     * only when TCP coalesces, which is the normal case at 60 Hz and never happens in a test that
     * feeds one frame at a time — so this asserts on the first message, not the last. */
    {
        ws_conn d;
        uint8_t both[16];
        size_t n = 0;
        int i;
        ws_init(&d, -1);
        d.on_message = record_msg;
        for (i = 0; i < 2; i++) {
            const char *body = i ? "ZZ" : "ab";
            both[n++] = 0x81;
            both[n++] = 0x82;
            both[n++] = 0x11; both[n++] = 0x22; both[n++] = 0x33; both[n++] = 0x44;
            both[n++] = (uint8_t)(body[0] ^ 0x11);
            both[n++] = (uint8_t)(body[1] ^ 0x22);
        }
        recorded = 0;
        ws_feed(&d, both, n);
        ck("both messages in one read arrive", recorded == 2);
        ck("the first is not clobbered by the second sitting behind it",
           recorded == 2 && !memcmp(record[0], "ab", 2));
        ck("and the second is intact too", recorded == 2 && !memcmp(record[1], "ZZ", 2));
        ws_dispose(&d);
    }

    /* A frame split across reads must be held until it is whole. */
    got_count = 0;
    {
        ws_conn d;
        uint8_t frame[] = { 0x81, 0x82, 0x11, 0x22, 0x33, 0x44, 'a' ^ 0x11, 'b' ^ 0x22 };
        ws_init(&d, -1);
        d.on_message = on_msg;
        ws_feed(&d, frame, 3);
        ck("a partial frame delivers nothing", got_count == 0);
        ws_feed(&d, frame + 3, sizeof frame - 3);
        ck("and completes when the rest arrives", got_count == 1 && !memcmp(got_msg, "ab", 2));
        ws_dispose(&d);
    }

    /* PROTOCOL.md §3 rules out each of these, so each must close rather than be tolerated. */
    {
        ws_conn d;
        uint8_t unmasked[] = { 0x81, 0x02, 'a', 'b' };
        ws_init(&d, -1);
        ws_feed(&d, unmasked, sizeof unmasked);
        ck("an unmasked client frame closes the socket", d.closing);
        ws_dispose(&d);
    }
    {
        ws_conn d;
        uint8_t rsv[] = { 0xc1, 0x82, 0x11, 0x22, 0x33, 0x44, 0, 0 };
        ws_init(&d, -1);
        ws_feed(&d, rsv, sizeof rsv);
        ck("a reserved bit closes the socket (no extensions are negotiated)", d.closing);
        ws_dispose(&d);
    }
    {
        ws_conn d;
        uint8_t frag[] = { 0x01, 0x82, 0x11, 0x22, 0x33, 0x44, 0, 0 }; /* FIN clear */
        ws_init(&d, -1);
        d.on_message = on_msg;
        got_count = 0;
        ws_feed(&d, frag, sizeof frag);
        ck("a fragmented frame closes the socket and is not delivered",
           d.closing && got_count == 0);
        ws_dispose(&d);
    }
    {   /* 64 KB is over the §3 cap; the display must refuse rather than buffer it. */
        ws_conn d;
        uint8_t head[] = { 0x81, 0x80 | 127, 0, 0, 0, 0, 0, 1, 0, 0, 0x11, 0x22, 0x33, 0x44 };
        ws_init(&d, -1);
        ws_feed(&d, head, sizeof head);
        ck("a message over 60 KB is refused", d.closing);
        ws_dispose(&d);
    }

    /* A ping must be answered with a pong carrying the same payload, unmasked. */
    {
        ws_conn d;
        ws_init(&d, -1);
        feed_masked(&d, WS_OP_PING, "hi", 2);
        ck("ping is answered with an unmasked pong",
           d.out.len == 4 && d.out.p[0] == 0x8a && d.out.p[1] == 2 &&
           !memcmp(d.out.p + 2, "hi", 2));
        ws_dispose(&d);
    }

    /* Frames of 126..65535 bytes use the two byte length form. */
    {
        ws_conn d;
        char big[300];
        memset(big, 'x', sizeof big);
        ws_init(&d, -1);
        ws_send_text(&d, big, sizeof big);
        ck("the extended length form is used above 125 bytes",
           d.out.len == 4 + 300 && d.out.p[1] == 126 &&
           d.out.p[2] == (300 >> 8) && d.out.p[3] == (300 & 0xff));
        ws_dispose(&d);
    }
    ws_dispose(&c);
}


/* The Colorlight wire format. Offsets are written out longhand here, independently of
 * output_colorlight.c, so that a change to either side shows up as a failure rather than as two
 * files agreeing with each other about the wrong thing. d[n] is frame byte 13+n. */
static void test_colorlight(void) {
    unsigned char pkt[2048];
    int idx[3];

    /* colour order */
    ck("rgb is the identity order",
       colorlight_order("rgb", idx) == 0 && idx[0] == 0 && idx[1] == 1 && idx[2] == 2);
    ck("bgr reverses", colorlight_order("bgr", idx) == 0 && idx[0] == 2 && idx[1] == 1 && idx[2] == 0);
    ck("grb", colorlight_order("grb", idx) == 0 && idx[0] == 1 && idx[1] == 0 && idx[2] == 2);
    ck("upper case is accepted", colorlight_order("BGR", idx) == 0 && idx[0] == 2);
    ck("NULL means rgb", colorlight_order(NULL, idx) == 0 && idx[0] == 0 && idx[2] == 2);
    ck("a repeated channel is rejected", colorlight_order("rrg", idx) < 0);
    ck("an unknown channel is rejected", colorlight_order("xyz", idx) < 0);
    ck("a short order is rejected", colorlight_order("rg", idx) < 0);

    /* how a row is split into packets */
    ck("a 128 pixel row is one packet", colorlight_packets_per_row(128) == 1);
    ck("497 pixels still fit in one packet", colorlight_packets_per_row(497) == 1);
    ck("498 pixels need two", colorlight_packets_per_row(498) == 2);
    ck("994 pixels need two", colorlight_packets_per_row(994) == 2);
    ck("995 pixels need three", colorlight_packets_per_row(995) == 3);
    ck("a zero width row needs none", colorlight_packets_per_row(0) == 0);

    /* pixel packet header */
    {
        size_t n = colorlight_pixel_header(pkt, 300, 497, 128);
        const unsigned char *d = pkt + 13;
        ck("pixel packet goes to the card's fixed MAC",
           !memcmp(pkt, "\x11\x22\x33\x44\x55\x66", 6));
        ck("pixel packet comes from 22:22:33:44:55:66",
           !memcmp(pkt + 6, "\x22\x22\x33\x44\x55\x66", 6));
        ck("pixel packet type 0x55 is in the ethertype's high byte", pkt[12] == 0x55);
        ck("row 300 splits into d[0]=1 d[1]=44", d[0] == 1 && d[1] == 44);
        ck("pixel offset 497 splits into d[2]=1 d[3]=241", d[2] == 1 && d[3] == 241);
        ck("pixel count 128 splits into d[4]=0 d[5]=128", d[4] == 0 && d[5] == 128);
        ck("the two constants are 0x08 and 0x88", d[6] == 0x08 && d[7] == 0x88);
        ck("header is 21 bytes and the frame is 21 + 3 per pixel", n == 21 + 128 * 3);
    }

    /* a full width packet must still fit inside a 1500 byte MTU */
    {
        size_t n = colorlight_pixel_header(pkt, 0, 0, CL_MAX_PIXELS_PER_PACKET);
        ck("a maximum packet is exactly one MTU of payload", n - 14 == 1498 && n <= 1512);
    }

    /* pixels: RGBA in, three bytes out, alpha dropped */
    {
        static const uint8_t rgba[] = { 10, 20, 30, 255,  40, 50, 60, 0 };
        colorlight_pixel_header(pkt, 0, 0, 2);
        memset(pkt + 21, 0xee, 8);
        colorlight_order("rgb", idx);
        colorlight_pixels(pkt, 0, rgba, 2, idx);
        ck("rgb pixels are copied in order",
           pkt[21] == 10 && pkt[22] == 20 && pkt[23] == 30 &&
           pkt[24] == 40 && pkt[25] == 50 && pkt[26] == 60);
        ck("alpha is dropped rather than sent", pkt[27] == 0xee);

        colorlight_order("bgr", idx);
        colorlight_pixels(pkt, 0, rgba, 2, idx);
        ck("bgr swaps red and blue",
           pkt[21] == 30 && pkt[22] == 20 && pkt[23] == 10 &&
           pkt[24] == 60 && pkt[25] == 50 && pkt[26] == 40);

        /* placing a render inside a larger canvas: pixels land further into the packet and
           everything before them is left alone */
        colorlight_pixel_header(pkt, 0, 0, 8);
        memset(pkt + 21, 0, 24);
        colorlight_order("rgb", idx);
        colorlight_pixels(pkt, 5, rgba, 2, idx);
        ck("a destination offset leaves earlier pixels black",
           pkt[21] == 0 && pkt[35] == 0);
        ck("a destination offset writes at 3 bytes per pixel",
           pkt[36] == 10 && pkt[37] == 20 && pkt[38] == 30 &&
           pkt[39] == 40 && pkt[40] == 50 && pkt[41] == 60);
        ck("a destination offset leaves later pixels black", pkt[42] == 0);
    }

    /* sync / display packet */
    {
        size_t n = colorlight_sync(pkt, 200);
        const unsigned char *d = pkt + 13;
        ck("sync packet is 112 bytes", n == 112);
        ck("sync packet type 0x01", pkt[12] == 0x01);
        ck("d[0]=0x07 marks a PC rather than a sender card", d[0] == 0x07);
        ck("d[22] carries brightness", d[22] == 200);
        ck("d[23] is the constant 0x05", d[23] == 0x05);
        ck("d[25..27] carry per channel brightness", d[25] == 200 && d[26] == 200 && d[27] == 200);
        ck("d[24] is left alone", d[24] == 0);

        colorlight_sync(pkt, 999);
        ck("brightness above 255 clamps", d[22] == 255);
        colorlight_sync(pkt, -5);
        ck("brightness below 0 clamps", d[22] == 0);
    }

    /* brightness packet */
    {
        size_t n = colorlight_brightness(pkt, 128);
        const unsigned char *d = pkt + 13;
        ck("brightness packet is 77 bytes", n == 77);
        ck("brightness packet type 0x0A", pkt[12] == 0x0A);
        ck("d[0..2] all carry brightness", d[0] == 128 && d[1] == 128 && d[2] == 128);
        ck("d[3] onwards is zero", d[3] == 0 && d[4] == 0);
    }
}

/* The frame plan: the row map, the column window and the panel map. Written out longhand and
 * independently of output_colorlight.c, so a change to either shows up as a failure rather than as
 * two files agreeing about the wrong thing. The numbers are the bench wall of ../CLAUDE.md: a card
 * with a 1280x256 panel-space canvas, 1/32 scan against 1/16 panels, panels at canvas x 1024. */

/* The segment covering canvas column `x` of canvas row `row`, or NULL. Searching rather than
 * indexing keeps the tests independent of how the planner orders or splits its output. */
static const cl_seg *seg_at(const cl_pkt *pkts, const cl_seg *segs, int nSegs, int row, int x) {
    int i;
    for (i = 0; i < nSegs; i++) {
        const cl_pkt *p = &pkts[segs[i].pkt];
        int c = x - (p->pixOff + segs[i].dstOff);
        if (p->row == row && c >= 0 && c < segs[i].len) return &segs[i];
    }
    return NULL;
}

/* Where canvas pixel (x, row) reads from in the render, or -1 if nothing writes it. */
static int src_at(const cl_pkt *pkts, const cl_seg *segs, int nSegs, int row, int x) {
    const cl_seg *g = seg_at(pkts, segs, nSegs, row, x);
    if (!g) return -1;
    return g->srcOff + (x - (pkts[g->pkt].pixOff + g->dstOff)) * g->srcStep;
}

static void test_colorlight_plan(void) {
    char err[256];
    output_opts o;
    cl_pkt *pkts;
    cl_seg *segs;
    int np, ns, i;

    /* the plain case: no row map, no window, no panel map — one packet per row */
    memset(&o, 0, sizeof o);
    ck("a plain plan is accepted",
       colorlight_plan(64, 32, &o, NULL, 0, NULL, 0, &np, &ns, err, sizeof err) == 0);
    ck("plain 64x32 is one packet per row", np == 32);
    ck("plain 64x32 is one segment per packet", ns == 32);

    pkts = (cl_pkt *)calloc((size_t)np, sizeof *pkts);
    segs = (cl_seg *)calloc((size_t)ns, sizeof *segs);
    colorlight_plan(64, 32, &o, pkts, np, segs, ns, &np, &ns, err, sizeof err);
    ck("plain: the first packet is canvas row 0", pkts[0].row == 0 && pkts[0].pixOff == 0 &&
                                                  pkts[0].count == 64);
    ck("plain: it carries the whole row", segs[0].dstOff == 0 && segs[0].len == 64);
    ck("plain: unrotated, so the source walks forwards", segs[0].srcStep == 1);
    ck("plain: row 0 column 0 is render pixel 0", src_at(pkts, segs, ns, 0, 0) == 0);
    ck("plain: row 31 column 63 is the last render pixel",
       src_at(pkts, segs, ns, 31, 63) == 32 * 64 - 1);
    free(pkts); free(segs);

    /* the bench wall: 64x32 render at +1088+0 inside a 1280x256 canvas, row map 2 */
    memset(&o, 0, sizeof o);
    o.canvasW = 1280; o.canvasH = 256; o.offsetX = 1088; o.rowMap = 2; o.panelRows = 32;
    colorlight_plan(64, 32, &o, NULL, 0, NULL, 0, &np, &ns, err, sizeof err);
    /* 1280 wide is 3 packets a row (497 + 497 + 286), over 256 * 2 transmitted rows */
    ck("row map 2 doubles the transmitted rows", np == 3 * 512);
    ck("only the rendered rows carry pixels", ns == 32);

    pkts = (cl_pkt *)calloc((size_t)np, sizeof *pkts);
    segs = (cl_seg *)calloc((size_t)ns, sizeof *segs);
    colorlight_plan(64, 32, &o, pkts, np, segs, ns, &np, &ns, err, sizeof err);
    ck("full width splits at 497", pkts[0].count == 497 && pkts[1].pixOff == 497 &&
                                   pkts[2].pixOff == 994 && pkts[2].count == 286);
    ck("row 0 column 1088 is render pixel 0", src_at(pkts, segs, ns, 0, 1088) == 0);
    ck("nothing is written left of the render", src_at(pkts, segs, ns, 0, 1087) == -1);
    ck("nothing is written right of it", src_at(pkts, segs, ns, 0, 1152) == -1);
    /* rows 16..31 collide with 0..15 under a 1/32 scan and must go out black */
    for (i = 16; i < 32; i++)
        ck("row map 2 blacks the colliding upper rows", src_at(pkts, segs, ns, i, 1088) == -1);
    /* rows 32..47 are the lower data group: physical rows 16..31 */
    ck("canvas row 32 feeds panel row 16", src_at(pkts, segs, ns, 32, 1088) == 16 * 64);
    ck("canvas row 47 feeds panel row 31", src_at(pkts, segs, ns, 47, 1088) == 31 * 64);
    for (i = 48; i < 64; i++)
        ck("row map 2 blacks the colliding lower rows", src_at(pkts, segs, ns, i, 1088) == -1);
    ck("rows past the render are sent, but black", pkts[64 * 3].row == 64 &&
                                                   src_at(pkts, segs, ns, 64, 1088) == -1);
    ck("the last canvas row is still transmitted", pkts[np - 1].row == 511);
    free(pkts); free(segs);

    /* the same wall with the column window: one packet per row instead of three */
    o.trimWidth = 1;
    colorlight_plan(64, 32, &o, NULL, 0, NULL, 0, &np, &ns, err, sizeof err);
    ck("trimming a 64 wide render is one packet per row", np == 512);

    pkts = (cl_pkt *)calloc((size_t)np, sizeof *pkts);
    segs = (cl_seg *)calloc((size_t)ns, sizeof *segs);
    colorlight_plan(64, 32, &o, pkts, np, segs, ns, &np, &ns, err, sizeof err);
    ck("trimmed packets declare the render's own columns",
       pkts[0].pixOff == 1088 && pkts[0].count == 64);
    ck("trimming does not move a single pixel", src_at(pkts, segs, ns, 0, 1088) == 0 &&
                                                src_at(pkts, segs, ns, 47, 1151) == 31 * 64 + 63);
    ck("trimming does not disturb the row map", src_at(pkts, segs, ns, 16, 1088) == -1 &&
                                                src_at(pkts, segs, ns, 32, 1088) == 16 * 64);
    ck("every canvas row is still sent", pkts[511].row == 511);
    free(pkts); free(segs);

    /* a window wider than one packet still splits, from the window's own origin */
    memset(&o, 0, sizeof o);
    o.canvasW = 1280; o.canvasH = 32; o.offsetX = 100; o.trimWidth = 1;
    colorlight_plan(600, 32, &o, NULL, 0, NULL, 0, &np, &ns, err, sizeof err);
    ck("a 600 wide window is two packets a row", np == 64);
    pkts = (cl_pkt *)calloc((size_t)np, sizeof *pkts);
    segs = (cl_seg *)calloc((size_t)ns, sizeof *segs);
    colorlight_plan(600, 32, &o, pkts, np, segs, ns, &np, &ns, err, sizeof err);
    ck("the window's first packet starts at the render", pkts[0].pixOff == 100 &&
                                                         pkts[0].count == 497);
    ck("the window's second packet continues it", pkts[1].pixOff == 597 && pkts[1].count == 103);
    ck("a row split across packets is still contiguous in the render",
       src_at(pkts, segs, ns, 0, 596) == 496 && src_at(pkts, segs, ns, 0, 597) == 497);
    free(pkts); free(segs);

    /* the wall as actually built: panels mounted 90 degrees anticlockwise, in two canvas rows
     * nowhere near each other. Render is 64 wide x 128 tall; each panel is 32x64 of it. */
    memset(&o, 0, sizeof o);
    o.canvasW = 1280; o.canvasH = 256; o.rowMap = 2; o.panelRows = 32; o.trimWidth = 1;
    o.nPanels = 4;
    for (i = 0; i < 4; i++) { o.panels[i].w = 64; o.panels[i].h = 32; o.panels[i].rot = 90; }
    o.panels[0].srcX = 0;  o.panels[0].srcY = 0;  o.panels[0].dstX = 1088; o.panels[0].dstY = 224;
    o.panels[1].srcX = 32; o.panels[1].srcY = 0;  o.panels[1].dstX = 1088; o.panels[1].dstY = 0;
    o.panels[2].srcX = 0;  o.panels[2].srcY = 64; o.panels[2].dstX = 1024; o.panels[2].dstY = 224;
    o.panels[3].srcX = 32; o.panels[3].srcY = 64; o.panels[3].dstX = 1024; o.panels[3].dstY = 0;
    ck("the four panel wall plans",
       colorlight_plan(64, 128, &o, NULL, 0, NULL, 0, &np, &ns, err, sizeof err) == 0);
    ck("the window spans both panel columns", np == 512);
    pkts = (cl_pkt *)calloc((size_t)np, sizeof *pkts);
    segs = (cl_seg *)calloc((size_t)ns, sizeof *segs);
    colorlight_plan(64, 128, &o, pkts, np, segs, ns, &np, &ns, err, sizeof err);
    ck("the window is the two columns the panels occupy",
       pkts[0].pixOff == 1024 && pkts[0].count == 128);
    /* Panel 0 is wall (0,0)..(31,63) at canvas cell (17,7), rotated 90 anticlockwise on the wall.
     * Its canvas pixel (px,py) must therefore read wall pixel (py, 63-px), relative to the
     * panel's own origin — so canvas (1088, 224), the cell's top left, is wall row 63 column 0. */
    ck("panel 0 top left reads the wall's bottom left",
       src_at(pkts, segs, ns, 224 * 2, 1088) == 63 * 64 + 0);
    ck("stepping along the canvas row walks UP a wall column",
       src_at(pkts, segs, ns, 224 * 2, 1089) == 62 * 64 + 0);
    ck("the step is minus the render width",
       seg_at(pkts, segs, ns, 224 * 2, 1088)->srcStep == -64);
    ck("the far end of the canvas row is the top of the wall column",
       src_at(pkts, segs, ns, 224 * 2, 1151) == 0 * 64 + 0);
    /* Panel 1 is wall x 32..63 at canvas cell (17,0): the wall's top RIGHT half. */
    ck("panel 1 is the other half of the wall's top row",
       src_at(pkts, segs, ns, 0, 1088) == 63 * 64 + 32);
    /* Panels 2 and 3 are the wall's second row, wall y 64..127. */
    ck("panel 2 reads the wall's second row", src_at(pkts, segs, ns, 224 * 2, 1024) == 127 * 64);
    ck("panel 3 reads the wall's second row, right half",
       src_at(pkts, segs, ns, 0, 1024) == 127 * 64 + 32);
    /* Down the canvas cell is across the wall column, the other axis of the rotation. */
    ck("the next canvas row is the next wall column",
       src_at(pkts, segs, ns, 224 * 2 + 1, 1088) == 63 * 64 + 1);
    ck("the row map still blacks the collisions",
       src_at(pkts, segs, ns, 224 * 2 + 16, 1088) == -1);
    ck("the lower data group carries the cell's bottom half",
       src_at(pkts, segs, ns, 224 * 2 + 32, 1088) == 63 * 64 + 16);
    free(pkts); free(segs);

    /* the geometry that must be refused rather than sent */
    memset(&o, 0, sizeof o);
    o.canvasW = 1280; o.canvasH = 256; o.offsetX = 1240;
    ck("a render hanging off the canvas is refused",
       colorlight_plan(64, 32, &o, NULL, 0, NULL, 0, &np, &ns, err, sizeof err) < 0);
    memset(&o, 0, sizeof o);
    o.rowMap = 3;
    ck("row map 3 is refused",
       colorlight_plan(64, 32, &o, NULL, 0, NULL, 0, &np, &ns, err, sizeof err) < 0);
    memset(&o, 0, sizeof o);
    o.canvasH = 40; o.rowMap = 2; o.panelRows = 32;
    ck("row map 2 on a canvas that is not a whole number of panels is refused",
       colorlight_plan(64, 32, &o, NULL, 0, NULL, 0, &np, &ns, err, sizeof err) < 0);
    memset(&o, 0, sizeof o);
    o.canvasW = 1280; o.canvasH = 256; o.nPanels = 1;
    o.panels[0].w = 64; o.panels[0].h = 32; o.panels[0].rot = 45;
    ck("a rotation that is not a right angle is refused",
       colorlight_plan(64, 32, &o, NULL, 0, NULL, 0, &np, &ns, err, sizeof err) < 0);
    o.panels[0].rot = 90;
    ck("a rotated panel that would read outside the render is refused",
       colorlight_plan(64, 32, &o, NULL, 0, NULL, 0, &np, &ns, err, sizeof err) < 0);
    o.panels[0].rot = 0;
    ck("the same panel unrotated fits",
       colorlight_plan(64, 32, &o, NULL, 0, NULL, 0, &np, &ns, err, sizeof err) == 0);
}


/* Pacing (pacing.h). The edges are written out here as literal millisecond values rather than in
 * terms of PACE_EDGE*, so that moving an edge shows up as a failure instead of as two files
 * quietly agreeing about the new one. One frame at 60 Hz is 16.667 ms. */
/* The idle pattern: what an unattended wall shows, so it has to be right without anyone looking.
 * Checks the shape (an L of the declared arm length in every corner, pointing inwards), that it
 * is confined to the corners, and that the name round-trips -- a typo in --idle-pattern must be
 * rejected rather than silently leaving the wall black. */
static void test_corners(void) {
    int w = 16, h = 24, arm = PATTERN_CORNER_ARM, lit = 0, x, y;
    uint8_t *buf = (uint8_t *)malloc((size_t)w * h * 4);
    ck("corners: name round trips", pattern_by_name("corners") == PATTERN_CORNERS &&
       !strcmp(pattern_name(PATTERN_CORNERS), "corners"));
    ck("corners: a typo is rejected, not silently ignored", pattern_by_name("cornerz") == -1);

    pattern_render(PATTERN_CORNERS, w, h, buf);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (buf[((size_t)y * w + x) * 4]) lit++;
    /* Four Ls, each 2*arm-1 pixels (the corner pixel is shared by both arms). */
    ck("corners: exactly four Ls worth of lit pixels", lit == 4 * (2 * arm - 1));

    /* Every corner pixel lit, and both arms running inwards from it. */
    ck("corners: all four corner pixels lit",
       buf[0] && buf[((size_t)(w - 1)) * 4] &&
       buf[((size_t)(h - 1) * w) * 4] && buf[((size_t)(h - 1) * w + w - 1) * 4]);
    ck("corners: top-left arms run inwards",
       buf[((size_t)(arm - 1)) * 4] && buf[((size_t)(arm - 1) * w) * 4]);
    ck("corners: bottom-right arms run inwards",
       buf[((size_t)(h - 1) * w + w - arm) * 4] &&
       buf[((size_t)(h - arm) * w + w - 1) * 4]);
    /* Nothing in the middle: this sits on an idle wall for hours, it must not light the panel. */
    ck("corners: the centre is dark", !buf[((size_t)(h / 2) * w + w / 2) * 4]);
    ck("corners: just past the arm is dark", !buf[((size_t)arm) * 4]);
    /* Alpha is opaque everywhere, like every other pattern -- the output stage reads it. */
    ck("corners: opaque everywhere", buf[3] == 255 &&
       buf[((size_t)(h / 2) * w + w / 2) * 4 + 3] == 255);
    free(buf);
}

static void test_pacing(void) {
    pace_stat p;
    pace_set  live, rpt;
    strbuf    b;

    /* Bucket edges: 0.75, 1.5, 2.5 and 5 frames, i.e. 12.5, 25, 41.667 and 83.333 ms. */
    ck("pacing: 0 ms is early",              pace_bucket(0.0) == 0);
    ck("pacing: 12.4 ms is early",           pace_bucket(0.0124) == 0);
    ck("pacing: 12.6 ms is on time",         pace_bucket(0.0126) == 1);
    ck("pacing: one frame is on time",       pace_bucket(1.0 / 60.0) == 1);
    ck("pacing: 24.9 ms is on time",         pace_bucket(0.0249) == 1);
    ck("pacing: 25.1 ms is one frame late",  pace_bucket(0.0251) == 2);
    ck("pacing: two frames is one late",     pace_bucket(2.0 / 60.0) == 2);
    ck("pacing: 41.5 ms is one frame late",  pace_bucket(0.0415) == 2);
    ck("pacing: 41.8 ms is a short stall",   pace_bucket(0.0418) == 3);
    ck("pacing: 83.2 ms is a short stall",   pace_bucket(0.0832) == 3);
    ck("pacing: 83.4 ms is a stall",         pace_bucket(0.0834) == 4);
    ck("pacing: 1 s is a stall",             pace_bucket(1.0) == 4);

    /* A fresh stat is empty, and its first mark only establishes a baseline. */
    pace_init(&p);
    ck("pacing: a fresh stat has no samples", p.n == 0 && p.max == 0.0);
    pace_mark(&p, 100.0);
    ck("pacing: the first mark records nothing", p.n == 0);
    pace_mark(&p, 100.0 + 1.0 / 60.0);
    ck("pacing: the second mark records a gap", p.n == 1 && p.bucket[1] == 1);
    pace_mark(&p, 100.0 + 1.0 / 60.0 + 0.1);
    ck("pacing: a 100 ms gap is a stall", p.n == 2 && p.bucket[4] == 1);
    ck("pacing: max is the worst gap", p.max > 0.0999 && p.max < 0.1001);
    ck("pacing: mean is over both gaps",
       p.sum / p.n > 0.0583 && p.sum / p.n < 0.0584);

    /* A backwards clock, or a duration a caller never measured, must not corrupt the mean. */
    pace_add(&p, -1.0);
    ck("pacing: a negative interval is ignored", p.n == 2);

    /* reset clears the window but keeps `prev`, so the next gap is real rather than measured from
     * zero — which would otherwise put one spurious stall in every single window. */
    pace_reset(&p);
    ck("pacing: reset clears the window", p.n == 0 && p.max == 0.0 && p.bucket[4] == 0);
    pace_mark(&p, 100.0 + 1.0 / 60.0 + 0.1 + 1.0 / 60.0);
    ck("pacing: reset keeps the baseline", p.n == 1 && p.bucket[1] == 1);

    /* pace_init, unlike pace_reset, forgets the baseline too. */
    pace_init(&p);
    pace_mark(&p, 500.0);
    ck("pacing: init forgets the baseline", p.n == 0);

    /* A set rolls into the reported copy and starts over. */
    pace_set_init(&live);
    pace_set_init(&rpt);
    pace_add(&live.arrive, 1.0 / 60.0);
    pace_add(&live.render, 0.004);
    live.seqGaps = 2;
    live.seqSkipped = 5;
    pace_set_roll(&live, &rpt);
    ck("pacing: roll copies the window", rpt.arrive.n == 1 && rpt.render.n == 1);
    ck("pacing: roll copies the seq gaps", rpt.seqGaps == 2 && rpt.seqSkipped == 5);
    ck("pacing: roll clears the live window", live.arrive.n == 0 && live.render.n == 0);
    ck("pacing: roll clears the live seq gaps", live.seqGaps == 0 && live.seqSkipped == 0);

    /* The JSON is what /debug and `stat` carry, so its shape is part of the contract. */
    sb_init(&b);
    pace_json(&b, "arrive", &rpt.arrive);
    ck("pacing: a series serialises with n, mean, max and buckets",
       strstr(b.buf, "\"arrive\":{\"n\":1,\"mean\":16.66") != NULL &&
       strstr(b.buf, "\"b\":[0,1,0,0,0]}") != NULL);
    sb_free(&b);

    sb_init(&b);
    pace_set_json(&b, &rpt);
    ck("pacing: a set serialises all four series",
       strstr(b.buf, "\"host\":") && strstr(b.buf, "\"arrive\":") &&
       strstr(b.buf, "\"draw\":") && strstr(b.buf, "\"render\":"));
    ck("pacing: a set serialises the seq gaps",
       strstr(b.buf, "\"seqGaps\":2,\"seqSkipped\":5}") != NULL);
    ck("pacing: an empty series reports a zero mean rather than a NaN",
       strstr(b.buf, "\"host\":{\"n\":0,\"mean\":0,") != NULL);
    sb_free(&b);
}

int main(void) {
    printf("== limut HUB75 display selftest ==\n");
    test_hashes();
    test_json();
    test_codec();
    test_glsl();
    test_ws();
    test_colorlight();
    test_colorlight_plan();
    test_pacing();
    test_corners();
    printf("%s: %d checks, %d failure%s\n",
           failures ? "FAILED" : "ALL PASSED", checks, failures, failures == 1 ? "" : "s");
    return failures ? 1 : 0;
}
