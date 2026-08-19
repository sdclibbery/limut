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
#include "sha1.h"
#include "sha256.h"
#include "ws.h"

#include <stdio.h>
#include <stdlib.h>
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

int main(void) {
    printf("== limut HUB75 display selftest ==\n");
    test_hashes();
    test_json();
    test_codec();
    test_glsl();
    test_ws();
    printf("%s: %d checks, %d failure%s\n",
           failures ? "FAILED" : "ALL PASSED", checks, failures, failures == 1 ? "" : "s");
    return failures ? 1 : 0;
}
