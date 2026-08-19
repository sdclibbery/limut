/* json.h - a small tokenising JSON parser plus a growable output buffer.
 *
 * Tailored to this protocol rather than vendored: the message set in PROTOCOL.md §5 is tiny and
 * entirely flat except for `layer.textures`, so a token array with parent links answers every
 * question the session state machine asks, with no allocation per message.
 *
 * Token convention (the jsmn one): an object's KEY tokens have parent == the object, and each
 * VALUE token has parent == its key token. Array elements have parent == the array.
 * String token start/end bracket the CONTENTS, still escaped — js_str() unescapes.
 */
#ifndef HUB75_JSON_H
#define HUB75_JSON_H

#include <stddef.h>

typedef enum {
    JS_UNDEF = 0, JS_OBJ, JS_ARR, JS_STR, JS_NUM, JS_TRUE, JS_FALSE, JS_NULL
} js_type;

typedef struct {
    js_type type;
    int start, end;  /* byte range in the source; for strings, the contents */
    int size;        /* object: key count; array: element count; key: 1 */
    int parent;
} js_tok;

/* Returns the token count, or -1 on malformed input / -2 if `max` tokens were not enough. */
int js_parse(const char *s, size_t len, js_tok *t, int max);

/* Value token for `key` in object token `obj`, or -1. */
int js_get(const char *s, const js_tok *t, int n, int obj, const char *key);

/* Element `idx` of array token `arr`, or -1. */
int js_at(const js_tok *t, int n, int arr, int idx);

/* 1 if token `i` is a string equal to `lit`. Comparison is on the raw bytes, which is right for
 * the fixed keywords this protocol uses (they never contain escapes). */
int js_streq(const char *s, const js_tok *t, int i, const char *lit);

/* Unescape string token `i` into `out` (NUL terminated). Returns the length, or -1 if it does not
 * fit or the escapes are malformed. \uXXXX is emitted as UTF-8; surrogate pairs are combined. */
int js_str(const char *s, const js_tok *t, int i, char *out, size_t cap);

/* Same, malloc'd. Caller frees. Returns NULL on failure. */
char *js_str_dup(const char *s, const js_tok *t, int i, size_t *outLen);

double js_num(const char *s, const js_tok *t, int i, double dflt);
int    js_bool(const js_tok *t, int i, int dflt);

/* ---- output ---------------------------------------------------------------------------- */

typedef struct {
    char  *buf;
    size_t len, cap;
    int    err;   /* set once an allocation failed; every later call is a no-op */
} strbuf;

void sb_init(strbuf *b);
void sb_free(strbuf *b);
void sb_reset(strbuf *b);
int  sb_addn(strbuf *b, const void *p, size_t n);
int  sb_add(strbuf *b, const char *s);
int  sb_addf(strbuf *b, const char *fmt, ...);
/* Appends a complete JSON string literal, quotes included, escaping as needed. */
int  sb_json_str(strbuf *b, const char *s, size_t n);
/* Appends a number, using the shortest representation that round-trips, and never `nan`/`inf`
 * (which are not JSON and would make the host's JSON.parse throw). */
int  sb_json_num(strbuf *b, double v);

#endif
