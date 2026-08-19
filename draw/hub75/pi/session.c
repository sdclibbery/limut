/* session.c - the protocol state machine of PROTOCOL.md §5-§12.
 *
 * draw/hub75/mock/display.js is the reference implementation and this follows it path for path,
 * including the paths that only run when something is wrong. Where the two could differ they
 * must not: mock/selftest.js is pointed at both.
 */
#include "display.h"
#include "glsl.h"
#include "patterns.h"
#include "sha256.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define MAX_TOKENS 4096

double now_seconds(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec + (double)ts.tv_nsec / 1e9;
}

static void vlog(display *d, const char *fmt, ...) {
    va_list ap;
    if (!d->verbose) return;
    va_start(ap, fmt);
    vfprintf(stdout, fmt, ap);
    va_end(ap);
    fputc('\n', stdout);
    fflush(stdout);
}

/* ---- sending ------------------------------------------------------------------------------ */

static void send_json(ws_conn *c, strbuf *b) {
    if (!c || b->err) return;
    ws_send_text(c, b->buf, b->len);
}

static void send_err(display *d, ws_conn *c, const char *kind, const char *id, const char *log) {
    strbuf b;
    sb_init(&b);
    sb_add(&b, "{\"type\":\"error\",\"kind\":");
    sb_json_str(&b, kind, strlen(kind));
    if (id) { sb_add(&b, ",\"id\":"); sb_json_str(&b, id, strlen(id)); }
    sb_add(&b, ",\"log\":");
    sb_json_str(&b, log, strlen(log));
    sb_add(&b, "}");
    send_json(c, &b);
    sb_free(&b);
    vlog(d, "  -> error %s %s: %s", kind, id ? id : "", log);
}

/* A protocol error means the two ends disagree about state. §8 closes the session rather than
 * limping on, so the bug is visible instead of showing a wrong picture. */
static void protocol_error(display *d, ws_conn *c, const char *fmt, ...) {
    char msg[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof msg, fmt, ap);
    va_end(ap);
    send_err(d, c, "protocol", NULL, msg);
    ws_close(c, WS_CLOSE_PROTOCOL, "protocol");
}

static void send_closed(ws_conn *c, const char *reason) {
    strbuf b;
    sb_init(&b);
    sb_add(&b, "{\"type\":\"closed\",\"reason\":");
    sb_json_str(&b, reason, strlen(reason));
    sb_add(&b, "}");
    send_json(c, &b);
    sb_free(&b);
}

static void gl_json(display *d, strbuf *b) {
    const char *v = render_gl_version(d->r), *rn = render_gl_renderer(d->r);
    sb_add(b, "{\"version\":");
    sb_json_str(b, v, strlen(v));
    sb_add(b, ",\"renderer\":");
    sb_json_str(b, rn, strlen(rn));
    sb_addf(b, ",\"maxTextureSize\":%d}", d->maxTextureSize);
}

/* The internal state the mock exposes to its test client as `main.display`. A DEBUG route, not
 * part of protocol v1 — it exists so mock/selftest.js can assert on what a real display observed
 * exactly as it does against the mock, rather than needing a second, weaker set of assertions.
 * The shape here is the mock's, field for field. */
void display_debug_json(display *d, strbuf *b) {
    int i;
    sb_add(b, "{\"dim\":");
    sb_json_num(b, (double)d->dim);
    sb_add(b, ",\"testPattern\":");
    sb_json_str(b, pattern_name(d->testPattern), strlen(pattern_name(d->testPattern)));
    sb_addf(b, ",\"lastSeq\":%lld,\"sessions\":%d,", d->lastSeq, d->sessions);
    sb_addf(b, "\"stats\":{\"rendered\":%llu,\"dropped\":%llu,\"stale\":%llu,\"fps\":%d},",
            d->rendered, d->dropped, d->stale, d->fps);
    if (!d->layerBound) {
        sb_add(b, "\"layer\":null");
    } else {
        sb_add(b, "\"layer\":{\"id\":0,\"prog\":");
        sb_json_str(b, d->layerProg, strlen(d->layerProg));
        sb_add(b, ",\"textures\":[");
        for (i = 0; i < d->nLayerTex; i++) {
            const char *samp = d->layerTex[i].sampler == 3 ? "sampler3D" : "sampler2D";
            sb_addf(b, "%s{\"unit\":%d,\"sampler\":", i ? "," : "", d->layerTex[i].unit);
            sb_json_str(b, samp, strlen(samp));
            sb_add(b, ",\"asset\":");
            sb_json_str(b, d->layerTex[i].asset, strlen(d->layerTex[i].asset));
            sb_add(b, "}");
        }
        sb_add(b, "]}");
    }
    sb_add(b, ",\"assets\":[");
    for (i = 0; i < d->cache.nAssets; i++) {
        sb_add(b, i ? "," : "");
        sb_json_str(b, d->cache.assets[i]->id, strlen(d->cache.assets[i]->id));
    }
    sb_add(b, "],\"progs\":[");
    for (i = 0; i < d->cache.nProgs; i++) {
        sb_add(b, i ? "," : "");
        sb_json_str(b, d->cache.progs[i]->id, strlen(d->cache.progs[i]->id));
    }
    sb_add(b, "]}");
}

void display_info_json(display *d, strbuf *b) {
    sb_addf(b, "{\"proto\":%d,\"name\":", HUB75_PROTO);
    sb_json_str(b, d->name, strlen(d->name));
    sb_addf(b, ",\"display\":{\"w\":%d,\"h\":%d},\"gl\":", d->w, d->h);
    gl_json(d, b);
    sb_addf(b, ",\"busy\":%s}", d->conn ? "true" : "false");
}

/* ---- lifecycle ----------------------------------------------------------------------------- */

int display_init(display *d, char *err, size_t errCap) {
    d->dim = 1.0f;
    d->testPattern = PATTERN_OFF;
    d->lastSeq = -1;
    d->needsRedraw = 1;
    cache_init(&d->cache, 64u * 1024 * 1024);
    d->scratch = (uint8_t *)calloc((size_t)d->w * d->h * 4, 1);
    if (!d->scratch) { snprintf(err, errCap, "out of memory for a %dx%d frame", d->w, d->h); return -1; }
    return 0;
}

void display_free(display *d) {
    cache_free(&d->cache);
    free(d->pending.data);
    free(d->scratch);
    if (d->r) render_destroy(d->r);
    output_close(&d->out);
}

/* ---- hello (§5.1) --------------------------------------------------------------------------- */

static void handle_hello(display *d, ws_conn *c, const char *s, js_tok *t, int n) {
    int proto = (int)js_num(s, t, js_get(s, t, n, 0, "proto"), -1);
    int takeover = js_bool(t, js_get(s, t, n, 0, "takeover"), 0);
    strbuf b;

    if (proto != HUB75_PROTO) {
        send_closed(c, "proto");
        ws_close(c, WS_CLOSE_PROTOCOL, "proto");
        return;
    }
    if (d->conn && d->conn != c) {
        if (!takeover) {
            send_closed(c, "busy");
            ws_close(c, WS_CLOSE_NORMAL, "busy");
            return;
        }
        /* Takeover is the norm for limut: a browser reload must never lock itself out. */
        {
            ws_conn *old = d->conn;
            d->conn = NULL;
            send_closed(old, "takeover");
            ws_close(old, WS_CLOSE_NORMAL, "takeover");
            vlog(d, "  session %s displaced by takeover", d->sessionId);
        }
    }
    /* Caches deliberately survive the session change (§5.1): they are content addressed, so a
     * browser reload costs a `have` round trip rather than re-uploading every texture. */
    d->conn = c;
    d->sessions++;
    snprintf(d->sessionId, sizeof d->sessionId, "s%d", d->sessions);
    {
        int nameTok = js_get(s, t, n, 0, "name");
        if (js_str(s, t, nameTok, d->clientName, sizeof d->clientName) < 0)
            snprintf(d->clientName, sizeof d->clientName, "anonymous");
    }
    d->lastSeq = -1;
    d->pending.active = 0;
    free(d->pending.data);
    d->pending.data = NULL;

    sb_init(&b);
    sb_addf(&b, "{\"type\":\"welcome\",\"proto\":%d,\"session\":", HUB75_PROTO);
    sb_json_str(&b, d->sessionId, strlen(d->sessionId));
    sb_add(&b, ",\"name\":");
    sb_json_str(&b, d->name, strlen(d->name));
    sb_addf(&b, ",\"display\":{\"w\":%d,\"h\":%d},\"gl\":", d->w, d->h);
    gl_json(d, &b);
    sb_add(&b, "}");
    send_json(c, &b);
    sb_free(&b);
    vlog(d, "  session %s opened by %s", d->sessionId, d->clientName);
}

/* ---- programs (§7.1) ------------------------------------------------------------------------ */

static void handle_prog(display *d, ws_conn *c, const char *s, js_tok *t, int n) {
    int idTok = js_get(s, t, n, 0, "id"), fragTok = js_get(s, t, n, 0, "frag");
    int uniTok = js_get(s, t, n, 0, "uniforms");
    char id[17], want[17];
    char (*names)[32] = NULL;
    char *namePtr[GLSL_MAX_UNIFORMS];
    char *frag = NULL;
    size_t fragLen = 0;
    int nNames = 0, i, isLink = 0;
    prog_entry *p;
    char log[2048];

    if (js_str(s, t, idTok, id, sizeof id) < 0 || fragTok < 0 || t[fragTok].type != JS_STR) {
        protocol_error(d, c, "bad prog message");
        return;
    }
    frag = js_str_dup(s, t, fragTok, &fragLen);
    if (!frag) { protocol_error(d, c, "bad prog message"); return; }

    if (uniTok >= 0 && t[uniTok].type == JS_ARR) nNames = t[uniTok].size;
    if (nNames > GLSL_MAX_UNIFORMS) { free(frag); protocol_error(d, c, "too many uniforms"); return; }
    names = (char (*)[32])calloc((size_t)(nNames > 0 ? nNames : 1), 32);
    if (!names) { free(frag); protocol_error(d, c, "out of memory"); return; }
    for (i = 0; i < nNames; i++) {
        if (js_str(s, t, js_at(t, n, uniTok, i), names[i], 32) < 0) {
            free(frag); free(names);
            protocol_error(d, c, "uniform names must be strings");
            return;
        }
        namePtr[i] = names[i];
    }

    p = cache_prog(&d->cache, id);
    if (p) {
        free(frag);
        /* The uniform list is a pure function of the source, so the same id arriving with a
         * different list means the host's codegen and its own bookkeeping disagree. */
        int same = (p->nUniforms == nNames);
        for (i = 0; same && i < nNames; i++) if (strcmp(p->uniforms[i], names[i]) != 0) same = 0;
        free(names);
        if (!same) {
            size_t used = 0;
            char list[512];
            list[0] = 0;
            for (i = 0; i < p->nUniforms; i++)
                used += (size_t)snprintf(list + used, used < sizeof list ? sizeof list - used : 0,
                                         "%s%s", i ? ", " : "", p->uniforms[i]);
            snprintf(log, sizeof log, "program %s was already sent with uniforms [%s]", id, list);
            send_err(d, c, "compile", id, log);
            return;
        }
        /* A cached id is acknowledged without recompiling, and a program that previously failed
         * to compile stays failed (§7.1). */
        if (p->ok) {
            strbuf b;
            sb_init(&b);
            sb_add(&b, "{\"type\":\"progok\",\"id\":");
            sb_json_str(&b, id, strlen(id));
            sb_add(&b, "}");
            send_json(c, &b);
            sb_free(&b);
        } else {
            send_err(d, c, "compile", id, p->log ? p->log : "compile failed");
        }
        return;
    }

    p = cache_add_prog(&d->cache, id, frag, names, nNames);
    free(names);
    if (!p) { free(frag); protocol_error(d, c, "out of memory"); return; }
    /* Re-point at the cache's copy: `names` has just been freed, and the checks below read it. */
    for (i = 0; i < nNames; i++) namePtr[i] = p->uniforms[i];

    sha256_id(p->frag, strlen(p->frag), want);
    if (strcmp(want, id) != 0) {
        snprintf(log, sizeof log,
                 "program id %s does not match the hash of its source (%s)", id, want);
        cache_prog_fail(p, log);
        p->glBuilt = 1; /* never worth compiling: the two ends disagree about what was sent */
        send_err(d, c, "compile", id, log);
        return;
    }

    /* Structural checks first, and they run even though a real compiler is available: a driver
     * compiles `uniform vec4 u_vs0;` happily whatever the announced list says, but the slot index
     * is positional on the wire (§7.1), so only this catches a mismatched list. */
    if (glsl_check_program(p->frag, namePtr, nNames, log, sizeof log) < 0) {
        cache_prog_fail(p, log);
        p->glBuilt = 1;
        send_err(d, c, "compile", id, log);
        return;
    }

    if (d->r) {
        if (render_build_program(d->r, p, &isLink) < 0) {
            send_err(d, c, isLink ? "link" : "compile", id, p->log ? p->log : "failed");
            return;
        }
    } else {
        p->ok = 1; /* no GPU: the structural checks are all there is */
    }

    {
        strbuf b;
        sb_init(&b);
        sb_add(&b, "{\"type\":\"progok\",\"id\":");
        sb_json_str(&b, id, strlen(id));
        sb_add(&b, "}");
        send_json(c, &b);
        sb_free(&b);
    }
    vlog(d, "  compiled program %s (%d uniforms)", id, nNames);
}

/* ---- layers (§7.2) -------------------------------------------------------------------------- */

static void handle_layer(display *d, ws_conn *c, const char *s, js_tok *t, int n) {
    int idTok = js_get(s, t, n, 0, "id");
    int progTok = js_get(s, t, n, 0, "prog");
    int texTok = js_get(s, t, n, 0, "textures");
    char progId[17], msg[512];
    prog_entry *p;
    layer_tex tex[MAX_LAYER_TEX];
    int bound[MAX_LAYER_TEX];
    int nTex = 0, i;

    if ((int)js_num(s, t, idTok, -1) != 0) {
        protocol_error(d, c, "proto %d supports layer 0 only, got %d",
                       HUB75_PROTO, (int)js_num(s, t, idTok, -1));
        return;
    }
    if (js_str(s, t, progTok, progId, sizeof progId) < 0) {
        protocol_error(d, c, "bad layer message");
        return;
    }
    p = cache_prog(&d->cache, progId);
    /* Ordered delivery means a layer naming an unknown program is a real host bug, not a race:
     * the prog message would have arrived first. Fail loudly (§7.2). */
    if (!p) {
        protocol_error(d, c, "layer names program %s, which was never sent", progId);
        return;
    }
    if (!p->ok) {
        send_err(d, c, "compile", progId, p->log ? p->log : "compile failed");
        return;
    }

    if (texTok >= 0 && t[texTok].type == JS_ARR) nTex = t[texTok].size;
    if (nTex > MAX_LAYER_TEX) {
        protocol_error(d, c, "a layer may bind at most %d textures", MAX_LAYER_TEX);
        return;
    }
    memset(tex, 0, sizeof tex);
    for (i = 0; i < MAX_LAYER_TEX; i++) bound[i] = 0;
    for (i = 0; i < nTex; i++) {
        int e = js_at(t, n, texTok, i);
        char sampler[32];
        int unit = (int)js_num(s, t, js_get(s, t, n, e, "unit"), -1);
        if (js_str(s, t, js_get(s, t, n, e, "sampler"), sampler, sizeof sampler) < 0)
            snprintf(sampler, sizeof sampler, "sampler2D");
        /* §7.2: units MUST be dense from 0. A sparse list would leave a sampler bound to
         * whatever was in that unit before. */
        if (unit < 0 || unit >= nTex) {
            protocol_error(d, c, "texture unit %d is out of range for %d bound texture(s):"
                                 " units must be dense from 0", unit, nTex);
            return;
        }
        if (bound[unit]) {
            protocol_error(d, c, "texture unit %d is bound twice", unit);
            return;
        }
        tex[unit].unit = unit;
        tex[unit].sampler = !strcmp(sampler, "sampler3D") ? 3 : 2;
        bound[unit] = tex[unit].sampler;
        if (js_str(s, t, js_get(s, t, n, e, "asset"), tex[unit].asset, 17) < 0) {
            protocol_error(d, c, "texture unit %d names no asset", unit);
            return;
        }
    }

    /* Every referenced asset MUST already be cached (§7.2). */
    {
        char missing[448]; /* sized so the message below cannot truncate */
        size_t used = 0;
        for (i = 0; i < nTex; i++) {
            if (cache_asset(&d->cache, tex[i].asset)) continue;
            used += (size_t)snprintf(missing + used, used < sizeof missing ? sizeof missing - used : 0,
                                     "%s%s", used ? ", " : "", tex[i].asset);
        }
        if (used) {
            snprintf(msg, sizeof msg, "layer needs assets not in the cache: %s", missing);
            send_err(d, c, "asset", progId, msg);
            return;
        }
    }

    /* The number and sampler types of the bound textures MUST match the source. A mismatch means
     * the two ends disagree about what the shader is (§7.2). */
    if (glsl_check_textures(p->frag, bound, nTex, msg, sizeof msg) < 0) {
        protocol_error(d, c, "%s", msg);
        return;
    }

    if (d->r) {
        for (i = 0; i < nTex; i++) {
            asset_entry *a = cache_asset(&d->cache, tex[i].asset);
            if (render_upload_asset(d->r, a, msg, sizeof msg) < 0) {
                send_err(d, c, "asset", tex[i].asset, msg);
                return;
            }
        }
    }

    d->layerBound = 1;
    snprintf(d->layerProg, sizeof d->layerProg, "%s", progId);
    memcpy(d->layerTex, tex, sizeof tex);
    d->nLayerTex = nTex;
    d->needsRedraw = 1;
    vlog(d, "  bound layer 0 to program %s with %d texture(s)", progId, nTex);
}

/* ---- assets (§6) ---------------------------------------------------------------------------- */

static void handle_asset(display *d, ws_conn *c, const char *s, js_tok *t, int n) {
    char id[17], kind[32], msg[256];
    double bytes = js_num(s, t, js_get(s, t, n, 0, "bytes"), -1);
    int chunks = (int)js_num(s, t, js_get(s, t, n, 0, "chunks"), -1);
    int expect;

    if (d->pending.active) { protocol_error(d, c, "an asset is already in flight"); return; }
    if (js_str(s, t, js_get(s, t, n, 0, "id"), id, sizeof id) < 0 || !(bytes >= 0)) {
        protocol_error(d, c, "bad asset announce");
        return;
    }
    if (js_str(s, t, js_get(s, t, n, 0, "kind"), kind, sizeof kind) < 0) kind[0] = 0;
    if (strcmp(kind, "lut") != 0 && strcmp(kind, "image") != 0) {
        snprintf(msg, sizeof msg, "unsupported asset kind %s", kind[0] ? kind : "(none)");
        send_err(d, c, "asset", id, msg);
        return;
    }
    if (!strcmp(kind, "image")) {
        /* Specified in §6 but not implemented at either end yet: the host's assets.classify
         * refuses image textures too, so nothing can reach here from limut. Saying so plainly
         * beats accepting bytes that would never be decoded. */
        send_err(d, c, "asset", id, "image assets are not implemented yet (PROTOCOL.md §6)");
        return;
    }
    expect = (int)((bytes + CODEC_CHUNK_SIZE - 1) / CODEC_CHUNK_SIZE);
    if (expect < 1) expect = 1;
    if (chunks != expect) {
        snprintf(msg, sizeof msg, "chunks %d does not match %.0f bytes (expected %d)",
                 chunks, bytes, expect);
        send_err(d, c, "asset", id, msg);
        return;
    }
    if (bytes > (double)(64u * 1024 * 1024)) {
        send_err(d, c, "asset", id, "asset is larger than the display will hold");
        return;
    }

    free(d->pending.data);
    memset(&d->pending, 0, sizeof d->pending);
    d->pending.active = 1;
    snprintf(d->pending.id, sizeof d->pending.id, "%s", id);
    d->pending.kind = ASSET_LUT;
    d->pending.dims = (int)js_num(s, t, js_get(s, t, n, 0, "dims"), 0);
    d->pending.size = (int)js_num(s, t, js_get(s, t, n, 0, "size"), 0);
    d->pending.bytes = (size_t)bytes;
    d->pending.chunks = chunks;
    d->pending.data = (uint8_t *)malloc(d->pending.bytes ? d->pending.bytes : 1);
    if (!d->pending.data) { d->pending.active = 0; protocol_error(d, c, "out of memory"); return; }
}

static void handle_chunk(display *d, ws_conn *c, const uint8_t *p, size_t n) {
    const char *err = NULL;
    const uint8_t *payload;
    size_t plen;
    uint16_t index;
    char got[17], msg[256];

    if (codec_decode_chunk(p, n, &index, &payload, &plen, &err) < 0) {
        protocol_error(d, c, "%s", err);
        return;
    }
    if (!d->pending.active) {
        send_err(d, c, "asset", NULL, "chunk with no asset announced");
        return;
    }
    if (index != (uint16_t)d->pending.next) {
        snprintf(msg, sizeof msg, "chunk out of order: expected %d, got %u", d->pending.next, index);
        send_err(d, c, "asset", d->pending.id, msg);
        d->pending.active = 0;
        free(d->pending.data);
        d->pending.data = NULL;
        return;
    }
    if (d->pending.got + plen > d->pending.bytes) {
        snprintf(msg, sizeof msg, "asset overruns the announced %zu bytes", d->pending.bytes);
        send_err(d, c, "asset", d->pending.id, msg);
        d->pending.active = 0;
        free(d->pending.data);
        d->pending.data = NULL;
        return;
    }
    memcpy(d->pending.data + d->pending.got, payload, plen);
    d->pending.got += plen;
    d->pending.next++;
    if (d->pending.next < d->pending.chunks) return;

    d->pending.active = 0;
    if (d->pending.got != d->pending.bytes) {
        snprintf(msg, sizeof msg, "asset is %zu bytes, announce said %zu",
                 d->pending.got, d->pending.bytes);
        send_err(d, c, "asset", d->pending.id, msg);
        free(d->pending.data);
        d->pending.data = NULL;
        return;
    }
    sha256_id(d->pending.data, d->pending.got, got);
    if (strcmp(got, d->pending.id) != 0) {
        snprintf(msg, sizeof msg, "content hash is %s, announce said %s", got, d->pending.id);
        send_err(d, c, "asset", d->pending.id, msg);
        free(d->pending.data);
        d->pending.data = NULL;
        return;
    }
    {
        /* dims/size are structural, and a lut whose byte count disagrees with them would be
         * uploaded with the wrong stride and show as garbage rather than as an error. */
        long long texels;
        int sz = d->pending.size;
        if (d->pending.dims == 1)      texels = sz;
        else if (d->pending.dims == 2) texels = (long long)sz * sz;
        else if (d->pending.dims == 3) texels = (long long)sz * sz * sz;
        else {
            snprintf(msg, sizeof msg, "lut dims %d is not 1, 2 or 3", d->pending.dims);
            send_err(d, c, "asset", d->pending.id, msg);
            free(d->pending.data);
            d->pending.data = NULL;
            return;
        }
        if ((long long)d->pending.got != texels * 4) {
            snprintf(msg, sizeof msg, "lut %dd size %d needs %lld bytes, got %zu",
                     d->pending.dims, sz, texels * 4, d->pending.got);
            send_err(d, c, "asset", d->pending.id, msg);
            free(d->pending.data);
            d->pending.data = NULL;
            return;
        }
        if (sz > d->maxTextureSize) {
            snprintf(msg, sizeof msg, "lut size %d exceeds maxTextureSize %d", sz, d->maxTextureSize);
            send_err(d, c, "asset", d->pending.id, msg);
            free(d->pending.data);
            d->pending.data = NULL;
            return;
        }
    }

    if (!cache_add_asset(&d->cache, d->pending.id, ASSET_LUT, d->pending.dims, d->pending.size,
                         d->pending.data, d->pending.got)) {
        free(d->pending.data);
        d->pending.data = NULL;
        protocol_error(d, c, "out of memory caching an asset");
        return;
    }
    d->pending.data = NULL; /* the cache owns it now */
    vlog(d, "  cached asset %s (lut %dd, %zu bytes)", d->pending.id, d->pending.dims, d->pending.got);
    {
        strbuf b;
        sb_init(&b);
        sb_add(&b, "{\"type\":\"assetok\",\"id\":");
        sb_json_str(&b, d->pending.id, strlen(d->pending.id));
        sb_add(&b, "}");
        send_json(c, &b);
        sb_free(&b);
    }
}

/* ---- frames (§12.1) -------------------------------------------------------------------------- */

static void handle_frame(display *d, ws_conn *c, const uint8_t *p, size_t n) {
    const char *err = NULL;
    codec_frame f;

    if (codec_decode_frame(p, n, &f, &err) < 0) { protocol_error(d, c, "%s", err); return; }
    /* Reordering after a reconnect: a packet older than the last one processed is discarded. */
    if ((long long)f.seq <= d->lastSeq) { d->stale++; return; }
    d->lastSeq = (long long)f.seq;
    if (f.layerCount > 1) {
        protocol_error(d, c, "proto %d allows at most one layer", HUB75_PROTO);
        return;
    }
    if (f.layerCount == 1) {
        prog_entry *p2;
        if (!d->layerBound) { protocol_error(d, c, "frame carries a layer but none is bound"); return; }
        p2 = cache_prog(&d->cache, d->layerProg);
        /* Positional slots (§12.1): a mismatch means the ends disagree about which program is
         * bound, which would silently render with the wrong values. */
        if (!p2 || f.uniformCount != p2->nUniforms) {
            protocol_error(d, c, "frame has %d uniforms, program %s declares %d",
                           (int)f.uniformCount, d->layerProg, p2 ? p2->nUniforms : -1);
            return;
        }
    }
    d->dim = f.dim < 0.0f ? 0.0f : f.dim > 1.0f ? 1.0f : f.dim;
    /* Last write wins: an undrawn frame that a newer one supersedes is dropped, not queued. On a
     * live wall staleness is worse than loss. */
    if (d->haveFrame) d->dropped++;
    d->frame = f;
    d->haveFrame = 1;
}

/* ---- dispatch ------------------------------------------------------------------------------- */

void display_on_text(display *d, ws_conn *c, const char *text, size_t n) {
    /* One buffer for the life of the process rather than a 100 KB malloc per message. The loop
     * is single threaded and this is never re-entered, so a static is the whole story. */
    static js_tok t[MAX_TOKENS];
    int count, typeTok;
    char type[32];

    count = js_parse(text, n, t, MAX_TOKENS);
    if (count <= 0 || t[0].type != JS_OBJ) {
        protocol_error(d, c, count == -2 ? "message has too many fields" : "malformed JSON");
        return;
    }
    typeTok = js_get(text, t, count, 0, "type");
    if (js_str(text, t, typeTok, type, sizeof type) < 0) {
        protocol_error(d, c, "message needs a string `type`");
        return;
    }
    if (d->verbose) vlog(d, "<- %.*s", (int)(n > 400 ? 400 : n), text);

    if (!strcmp(type, "hello")) { handle_hello(d, c, text, t, count); return; }
    /* A client MUST send hello first (§5.1). */
    if (d->conn != c) { protocol_error(d, c, "first message must be hello"); return; }

    if (!strcmp(type, "have")) {
        int ids = js_get(text, t, count, 0, "ids");
        int i, nIds = (ids >= 0 && t[ids].type == JS_ARR) ? t[ids].size : 0, first = 1;
        strbuf b;
        sb_init(&b);
        sb_add(&b, "{\"type\":\"have\",\"missing\":[");
        for (i = 0; i < nIds; i++) {
            char id[64];
            if (js_str(text, t, js_at(t, count, ids, i), id, sizeof id) < 0) continue;
            if (cache_known(&d->cache, id)) continue;
            if (!first) sb_add(&b, ",");
            first = 0;
            sb_json_str(&b, id, strlen(id));
        }
        sb_add(&b, "]}");
        send_json(c, &b);
        sb_free(&b);
    } else if (!strcmp(type, "asset")) {
        handle_asset(d, c, text, t, count);
    } else if (!strcmp(type, "prog")) {
        handle_prog(d, c, text, t, count);
    } else if (!strcmp(type, "layer")) {
        handle_layer(d, c, text, t, count);
    } else if (!strcmp(type, "unlayer")) {
        if (d->layerBound && (int)js_num(text, t, js_get(text, t, count, 0, "id"), -1) == 0) {
            d->layerBound = 0;
            d->nLayerTex = 0;
            d->needsRedraw = 1;
        }
    } else if (!strcmp(type, "dim")) {
        double v = js_num(text, t, js_get(text, t, count, 0, "v"), 1);
        d->dim = (float)(v < 0 ? 0 : v > 1 ? 1 : v);
        d->needsRedraw = 1;
    } else if (!strcmp(type, "test")) {
        char pat[32];
        int which;
        if (js_str(text, t, js_get(text, t, count, 0, "pattern"), pat, sizeof pat) < 0) pat[0] = 0;
        which = pattern_by_name(pat);
        if (which < 0) { protocol_error(d, c, "unknown test pattern %s", pat); return; }
        d->testPattern = which;
        d->needsRedraw = 1;
    } else if (!strcmp(type, "bye")) {
        send_closed(c, "bye");
        ws_close(c, WS_CLOSE_NORMAL, "bye");
    }
    /* Unknown types are ignored, for forward compatibility (§5.2). */
}

void display_on_binary(display *d, ws_conn *c, const uint8_t *p, size_t n) {
    int type;
    if (d->conn != c) { protocol_error(d, c, "binary packet before hello"); return; }
    type = codec_packet_type(p, n);
    if (type == CODEC_PACKET_FRAME) { handle_frame(d, c, p, n); return; }
    if (type == CODEC_PACKET_CHUNK) { handle_chunk(d, c, p, n); return; }
    protocol_error(d, c, "unknown binary packet type 0x%x", type);
}

void display_on_close(display *d, ws_conn *c) {
    if (d->conn != c) return;
    vlog(d, "  session %s closed", d->sessionId);
    d->conn = NULL;
    d->pending.active = 0;
    free(d->pending.data);
    d->pending.data = NULL;
}

/* ---- drawing -------------------------------------------------------------------------------- */

void display_draw(display *d) {
    double t0;
    char err[256];

    if (!d->haveFrame && !d->needsRedraw) return;
    t0 = now_seconds();
    d->haveFrame = 0;
    d->needsRedraw = 0;

    if (d->testPattern != PATTERN_OFF) {
        /* Patterns replace the layer entirely (§10), and the dimmer still applies because it
         * lives in the output stage. */
        pattern_render(d->testPattern, d->w, d->h, d->scratch);
    } else {
        prog_entry *p = d->layerBound ? cache_prog(&d->cache, d->layerProg) : NULL;
        asset_entry *tex[MAX_LAYER_TEX];
        int i, nTex = 0;
        if (p && p->ok && d->r) {
            for (i = 0; i < d->nLayerTex; i++) {
                tex[i] = cache_asset(&d->cache, d->layerTex[i].asset);
                if (!tex[i]) { p = NULL; break; }
                nTex++;
            }
        }
        if (p && p->ok && d->r) {
            if (render_frame(d->r, p, tex, nTex, d->frame.values, d->frame.uniformCount,
                             d->scratch, err, sizeof err) < 0) {
                /* §8: a render error holds the last frame rather than blanking mid-show. */
                if (d->conn) send_err(d, d->conn, "render", NULL, err);
                return;
            }
        } else {
            /* Nothing to draw: opaque black. Still goes through the output stage, so `dim` and
             * gamma stay live with no content bound. */
            size_t i2, n = (size_t)d->w * d->h;
            memset(d->scratch, 0, n * 4);
            for (i2 = 0; i2 < n; i2++) d->scratch[i2 * 4 + 3] = 255;
        }
    }

    output_frame(&d->out, d->scratch, d->dim);
    d->rendered++;
    d->renderMs = (now_seconds() - t0) * 1000.0;
}

/* ---- telemetry (§11) -------------------------------------------------------------------------- */

static double read_temp(void) {
    FILE *f = fopen("/sys/class/thermal/thermal_zone0/temp", "r");
    long milli = 0;
    if (!f) return 0.0;
    if (fscanf(f, "%ld", &milli) != 1) milli = 0;
    fclose(f);
    return (double)milli / 1000.0;
}

/* The undervoltage signal, without forking.
 *
 * vcgencmd get_throttled is the usual source, but it means a fork on a loop that is trying to
 * hold 60Hz, and a fork of a process holding a GL context is not free. The raspberrypi-hwmon
 * driver exposes the same rail supervisor as a plain sysfs file, so a read costs nothing.
 *
 * It reports the CURRENT state only, so the "has occurred" bit is latched here. The two bits
 * that come out are vcgencmd's own: 0x1 undervoltage now, 0x10000 undervoltage has occurred.
 * A non-zero value here is the signal that cost most of the Pi's first bring-up, and it usually
 * shows up as a network fault rather than a power one, so it is worth carrying (§11). */
static const char *volt_alarm_path(void) {
    static char path[128];
    static int looked = 0;
    int i;
    if (looked) return path[0] ? path : NULL;
    looked = 1;
    path[0] = 0;
    for (i = 0; i < 8; i++) {
        char namePath[128], name[32];
        FILE *f;
        snprintf(namePath, sizeof namePath, "/sys/class/hwmon/hwmon%d/name", i);
        f = fopen(namePath, "r");
        if (!f) continue;
        if (fgets(name, sizeof name, f)) {
            name[strcspn(name, "\n")] = 0;
            if (!strcmp(name, "rpi_volt"))
                snprintf(path, sizeof path, "/sys/class/hwmon/hwmon%d/in0_lcrit_alarm", i);
        }
        fclose(f);
        if (path[0]) break;
    }
    return path[0] ? path : NULL;
}

static unsigned read_throttled(unsigned latched) {
    const char *path = volt_alarm_path();
    FILE *f;
    int v = 0;
    if (!path) return latched;
    f = fopen(path, "r");
    if (!f) return latched;
    if (fscanf(f, "%d", &v) != 1) v = 0;
    fclose(f);
    if (v) return (latched | 0x1u | 0x10000u);
    return (latched & ~0x1u);
}

void display_tick(display *d, double now) {
    strbuf b;

    d->fps = (int)(d->rendered - d->fpsMark);
    d->fpsMark = d->rendered;
    d->temp = read_temp();
    d->throttled = read_throttled(d->throttled);
    d->throttledAt = now;
    if (!d->conn) return;

    sb_init(&b);
    sb_addf(&b, "{\"type\":\"stat\",\"fps\":%d,\"rendered\":%llu,\"dropped\":%llu,",
            d->fps, d->rendered, d->dropped);
    sb_add(&b, "\"renderMs\":");
    sb_json_num(&b, d->renderMs);
    sb_addf(&b, ",\"seq\":%lld,", d->lastSeq);
    sb_add(&b, "\"temp\":");
    sb_json_num(&b, d->temp);
    sb_addf(&b, ",\"throttled\":%u}", d->throttled);
    send_json(d->conn, &b);
    sb_free(&b);
    ws_ping(d->conn);
}
