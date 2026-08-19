/* cache.h - the content-addressed asset and program caches of PROTOCOL.md §6 and §7.1.
 *
 * Both survive a session change on purpose (§5.1): they are content addressed, so a browser
 * reload costs a `have` round trip rather than re-uploading every texture.
 *
 * Entries are held as an array of POINTERS, not an array of structs, so growing the cache never
 * moves an entry the bound layer or the renderer is holding.
 */
#ifndef HUB75_CACHE_H
#define HUB75_CACHE_H

#include <stddef.h>
#include <stdint.h>

enum { ASSET_LUT = 1, ASSET_IMAGE = 2 };

typedef struct {
    char     id[17];
    int      kind;
    int      dims, size;   /* lut geometry; 0 for an image until it is decoded */
    uint8_t *data;
    size_t   len;

    /* Filled in by render.c the first time the asset is bound. Kept here rather than in a
     * parallel table so there is exactly one lookup on the layer path. */
    unsigned glTex;
    int      glIs3d;
    int      glW, glH;     /* what u_vsex reports; §13 keeps it (0,0) for a lut */
} asset_entry;

typedef struct {
    char   id[17];
    char  *frag;
    char (*uniforms)[32];
    int    nUniforms;
    int    ok;             /* 0 while log is set; a failure here is permanent (§7.1) */
    char  *log;

    /* render.c's side */
    unsigned glProg;
    int      glBuilt;      /* 1 once a real compile has been attempted */
    int     *uniformLoc;   /* parallel to uniforms */
    int      texLoc[16], exLoc[16];
    int      nTextures;
} prog_entry;

typedef struct {
    asset_entry **assets;
    int           nAssets, capAssets;
    prog_entry  **progs;
    int           nProgs, capProgs;
    size_t        assetBytes;
    size_t        maxAssetBytes;
} cache;

void cache_init(cache *c, size_t maxAssetBytes);
void cache_free(cache *c);

asset_entry *cache_asset(cache *c, const char *id);
prog_entry  *cache_prog(cache *c, const char *id);

/* 1 if `id` names anything already held — what a `have` reply is computed from. */
int cache_known(cache *c, const char *id);

/* Takes ownership of `data`. Returns NULL only if out of memory. */
asset_entry *cache_add_asset(cache *c, const char *id, int kind, int dims, int size,
                             uint8_t *data, size_t len);

/* Takes ownership of `frag`. `names` is copied. */
prog_entry *cache_add_prog(cache *c, const char *id, char *frag,
                           char (*names)[32], int nNames);

/* Marks a program permanently failed with the given reason. */
void cache_prog_fail(prog_entry *p, const char *log);

/* Frees assets until the byte budget is met, skipping anything the given ids reference. Safe to
 * do at any time: the host never assumes the display's cache contents, it asks with `have`
 * (PROTOCOL.md §8), so an evicted asset simply gets uploaded again. */
void cache_evict(cache *c, const char *const *keepIds, int nKeep,
                 void (*releaseGl)(asset_entry *, void *), void *user);

#endif
