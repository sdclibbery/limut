#include "json.h"
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

/* ---- parser ------------------------------------------------------------------------------ */

static int alloc_tok(js_tok *t, int max, int *count) {
    if (*count >= max) return -1;
    js_tok *tok = &t[*count];
    tok->type = JS_UNDEF;
    tok->start = tok->end = -1;
    tok->size = 0;
    tok->parent = -1;
    return (*count)++;
}

static int parse_string(const char *s, size_t len, size_t *pos, js_tok *t, int max, int *count,
                        int super) {
    size_t i = *pos + 1; /* skip the opening quote */
    int idx = alloc_tok(t, max, count);
    if (idx < 0) return -2;
    t[idx].type = JS_STR;
    t[idx].start = (int)i;
    for (; i < len; i++) {
        char c = s[i];
        if (c == '"') {
            t[idx].end = (int)i;
            t[idx].parent = super;
            *pos = i;
            return idx;
        }
        if (c == '\\') {
            if (++i >= len) return -1;
            switch (s[i]) {
            case '"': case '\\': case '/': case 'b': case 'f':
            case 'r': case 'n':  case 't':
                break;
            case 'u':
                if (i + 4 >= len) return -1;
                for (int k = 1; k <= 4; k++) {
                    char h = s[i + k];
                    int ok = (h >= '0' && h <= '9') || (h >= 'a' && h <= 'f') || (h >= 'A' && h <= 'F');
                    if (!ok) return -1;
                }
                i += 4;
                break;
            default:
                return -1;
            }
        }
    }
    return -1; /* unterminated */
}

static int parse_prim(const char *s, size_t len, size_t *pos, js_tok *t, int max, int *count,
                      int super) {
    size_t start = *pos, i = start;
    int idx;
    for (; i < len; i++) {
        char c = s[i];
        if (c == ',' || c == '}' || c == ']' || c == ' ' || c == '\t' || c == '\r' || c == '\n')
            break;
        if (c < 32 || c >= 127) return -1;
    }
    idx = alloc_tok(t, max, count);
    if (idx < 0) return -2;
    t[idx].start = (int)start;
    t[idx].end = (int)i;
    t[idx].parent = super;
    size_t n = i - start;
    if      (n == 4 && !strncmp(s + start, "true", 4))  t[idx].type = JS_TRUE;
    else if (n == 5 && !strncmp(s + start, "false", 5)) t[idx].type = JS_FALSE;
    else if (n == 4 && !strncmp(s + start, "null", 4))  t[idx].type = JS_NULL;
    else {
        char c = s[start];
        if (!(c == '-' || (c >= '0' && c <= '9'))) return -1;
        t[idx].type = JS_NUM;
    }
    *pos = i - 1;
    return idx;
}

int js_parse(const char *s, size_t len, js_tok *t, int max) {
    int count = 0, super = -1;
    size_t i;
    for (i = 0; i < len; i++) {
        char c = s[i];
        switch (c) {
        case '{': case '[': {
            int idx = alloc_tok(t, max, &count);
            if (idx < 0) return -2;
            t[idx].type = (c == '{') ? JS_OBJ : JS_ARR;
            t[idx].start = (int)i;
            t[idx].parent = super;
            if (super >= 0) t[super].size++;
            super = idx;
            break;
        }
        case '}': case ']': {
            js_type want = (c == '}') ? JS_OBJ : JS_ARR;
            int j;
            for (j = count - 1; j >= 0; j--) {
                if (t[j].start != -1 && t[j].end == -1) {
                    if (t[j].type != want) return -1;
                    t[j].end = (int)i + 1;
                    super = t[j].parent;
                    break;
                }
            }
            if (j < 0) return -1; /* closer with nothing open */
            break;
        }
        case '"': {
            int idx = parse_string(s, len, &i, t, max, &count, super);
            if (idx < 0) return idx;
            if (super >= 0) t[super].size++;
            break;
        }
        case ':':
            /* the string just parsed becomes the container for the value that follows */
            super = count - 1;
            break;
        case ',':
            /* leaving a key's value slot: pop back to the enclosing object */
            if (super >= 0 && t[super].type != JS_OBJ && t[super].type != JS_ARR)
                super = t[super].parent;
            break;
        case ' ': case '\t': case '\r': case '\n':
            break;
        default: {
            int idx = parse_prim(s, len, &i, t, max, &count, super);
            if (idx < 0) return idx;
            if (super >= 0) t[super].size++;
            break;
        }
        }
    }
    /* anything still open is truncated input */
    for (i = 0; i < (size_t)count; i++) if (t[i].end == -1) return -1;
    /* Every direct child of an object must be a key string carrying exactly one value. Without
     * this, `{"a":}` parses happily and the missing value reads as an absent field instead of as
     * the malformed JSON it is. */
    for (i = 0; i < (size_t)count; i++) {
        int p = t[i].parent;
        if (p < 0 || t[p].type != JS_OBJ) continue;
        if (t[i].type != JS_STR || t[i].size != 1) return -1;
    }
    return count;
}

/* ---- accessors --------------------------------------------------------------------------- */

int js_streq(const char *s, const js_tok *t, int i, const char *lit) {
    size_t n;
    if (i < 0 || t[i].type != JS_STR) return 0;
    n = strlen(lit);
    return (size_t)(t[i].end - t[i].start) == n && !strncmp(s + t[i].start, lit, n);
}

int js_get(const char *s, const js_tok *t, int n, int obj, const char *key) {
    int i;
    if (obj < 0 || t[obj].type != JS_OBJ) return -1;
    for (i = obj + 1; i < n; i++) {
        if (t[i].parent != obj) continue;
        if (js_streq(s, t, i, key)) {
            /* the value is the next token, and carries the key as its parent */
            if (i + 1 < n && t[i + 1].parent == i) return i + 1;
            return -1;
        }
    }
    return -1;
}

int js_at(const js_tok *t, int n, int arr, int idx) {
    int i, seen = 0;
    if (arr < 0 || t[arr].type != JS_ARR) return -1;
    for (i = arr + 1; i < n; i++) {
        if (t[i].parent != arr) continue;
        if (seen++ == idx) return i;
    }
    return -1;
}

static int hex4(const char *p) {
    int v = 0, k;
    for (k = 0; k < 4; k++) {
        char c = p[k];
        v <<= 4;
        if (c >= '0' && c <= '9') v |= c - '0';
        else if (c >= 'a' && c <= 'f') v |= c - 'a' + 10;
        else if (c >= 'A' && c <= 'F') v |= c - 'A' + 10;
        else return -1;
    }
    return v;
}

int js_str(const char *s, const js_tok *t, int i, char *out, size_t cap) {
    size_t o = 0;
    int p;
    if (i < 0 || t[i].type != JS_STR || cap == 0) return -1;
    for (p = t[i].start; p < t[i].end; p++) {
        char c = s[p];
        if (c != '\\') {
            if (o + 1 >= cap) return -1;
            out[o++] = c;
            continue;
        }
        p++;
        switch (s[p]) {
        case 'n': c = '\n'; break;
        case 't': c = '\t'; break;
        case 'r': c = '\r'; break;
        case 'b': c = '\b'; break;
        case 'f': c = '\f'; break;
        case '"': case '\\': case '/': c = s[p]; break;
        case 'u': {
            int cp = hex4(s + p + 1);
            if (cp < 0) return -1;
            p += 4;
            /* combine a surrogate pair, so astral characters survive the round trip */
            if (cp >= 0xd800 && cp <= 0xdbff && p + 6 < t[i].end &&
                s[p + 1] == '\\' && s[p + 2] == 'u') {
                int lo = hex4(s + p + 3);
                if (lo >= 0xdc00 && lo <= 0xdfff) {
                    cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
                    p += 6;
                }
            }
            if (cp < 0x80) {
                if (o + 1 >= cap) return -1;
                out[o++] = (char)cp;
            } else if (cp < 0x800) {
                if (o + 2 >= cap) return -1;
                out[o++] = (char)(0xc0 | (cp >> 6));
                out[o++] = (char)(0x80 | (cp & 63));
            } else if (cp < 0x10000) {
                if (o + 3 >= cap) return -1;
                out[o++] = (char)(0xe0 | (cp >> 12));
                out[o++] = (char)(0x80 | ((cp >> 6) & 63));
                out[o++] = (char)(0x80 | (cp & 63));
            } else {
                if (o + 4 >= cap) return -1;
                out[o++] = (char)(0xf0 | (cp >> 18));
                out[o++] = (char)(0x80 | ((cp >> 12) & 63));
                out[o++] = (char)(0x80 | ((cp >> 6) & 63));
                out[o++] = (char)(0x80 | (cp & 63));
            }
            continue;
        }
        default: return -1;
        }
        if (o + 1 >= cap) return -1;
        out[o++] = c;
    }
    out[o] = 0;
    return (int)o;
}

char *js_str_dup(const char *s, const js_tok *t, int i, size_t *outLen) {
    size_t cap;
    char *buf;
    int n;
    if (i < 0 || t[i].type != JS_STR) return NULL;
    cap = (size_t)(t[i].end - t[i].start) + 1; /* unescaping only ever shrinks */
    buf = (char *)malloc(cap);
    if (!buf) return NULL;
    n = js_str(s, t, i, buf, cap);
    if (n < 0) { free(buf); return NULL; }
    if (outLen) *outLen = (size_t)n;
    return buf;
}

double js_num(const char *s, const js_tok *t, int i, double dflt) {
    char tmp[64];
    size_t n;
    if (i < 0 || t[i].type != JS_NUM) return dflt;
    n = (size_t)(t[i].end - t[i].start);
    if (n >= sizeof tmp) return dflt;
    memcpy(tmp, s + t[i].start, n);
    tmp[n] = 0;
    return atof(tmp);
}

int js_bool(const js_tok *t, int i, int dflt) {
    if (i < 0) return dflt;
    if (t[i].type == JS_TRUE) return 1;
    if (t[i].type == JS_FALSE) return 0;
    return dflt;
}

/* ---- output ------------------------------------------------------------------------------ */

void sb_init(strbuf *b) { b->buf = NULL; b->len = b->cap = 0; b->err = 0; }
void sb_free(strbuf *b) { free(b->buf); sb_init(b); }
void sb_reset(strbuf *b) { b->len = 0; b->err = 0; if (b->buf) b->buf[0] = 0; }

static int sb_room(strbuf *b, size_t extra) {
    size_t want;
    char *p;
    if (b->err) return -1;
    want = b->len + extra + 1;
    if (want <= b->cap) return 0;
    while (b->cap < want) b->cap = b->cap ? b->cap * 2 : 256;
    p = (char *)realloc(b->buf, b->cap);
    if (!p) { b->err = 1; return -1; }
    b->buf = p;
    return 0;
}

int sb_addn(strbuf *b, const void *p, size_t n) {
    if (sb_room(b, n) < 0) return -1;
    memcpy(b->buf + b->len, p, n);
    b->len += n;
    b->buf[b->len] = 0;
    return 0;
}

int sb_add(strbuf *b, const char *s) { return sb_addn(b, s, strlen(s)); }

int sb_addf(strbuf *b, const char *fmt, ...) {
    va_list ap;
    int n;
    if (b->err) return -1;
    va_start(ap, fmt);
    n = vsnprintf(NULL, 0, fmt, ap);
    va_end(ap);
    if (n < 0) { b->err = 1; return -1; }
    if (sb_room(b, (size_t)n) < 0) return -1;
    va_start(ap, fmt);
    vsnprintf(b->buf + b->len, (size_t)n + 1, fmt, ap);
    va_end(ap);
    b->len += (size_t)n;
    return 0;
}

int sb_json_str(strbuf *b, const char *s, size_t n) {
    size_t i;
    if (sb_addn(b, "\"", 1) < 0) return -1;
    for (i = 0; i < n; i++) {
        unsigned char c = (unsigned char)s[i];
        int r;
        switch (c) {
        case '"':  r = sb_addn(b, "\\\"", 2); break;
        case '\\': r = sb_addn(b, "\\\\", 2); break;
        case '\n': r = sb_addn(b, "\\n", 2); break;
        case '\r': r = sb_addn(b, "\\r", 2); break;
        case '\t': r = sb_addn(b, "\\t", 2); break;
        case '\b': r = sb_addn(b, "\\b", 2); break;
        case '\f': r = sb_addn(b, "\\f", 2); break;
        default:
            /* Control characters must be escaped; everything else, including UTF-8 continuation
             * bytes, goes through untouched. */
            if (c < 0x20) r = sb_addf(b, "\\u%04x", c);
            else          r = sb_addn(b, &s[i], 1);
        }
        if (r < 0) return -1;
    }
    return sb_addn(b, "\"", 1);
}

int sb_json_num(strbuf *b, double v) {
    if (!isfinite(v)) return sb_addn(b, "0", 1); /* NaN/Inf are not JSON */
    if (v == (double)(long long)v && v > -1e15 && v < 1e15)
        return sb_addf(b, "%lld", (long long)v);
    return sb_addf(b, "%.6g", v);
}
