#include "cache.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void cache_init(cache *c, size_t maxAssetBytes) {
    memset(c, 0, sizeof *c);
    c->maxAssetBytes = maxAssetBytes;
}

static void free_asset(asset_entry *a) {
    free(a->data);
    free(a);
}

static void free_prog(prog_entry *p) {
    free(p->frag);
    free(p->uniforms);
    free(p->uniformLoc);
    free(p->log);
    free(p);
}

void cache_free(cache *c) {
    int i;
    for (i = 0; i < c->nAssets; i++) free_asset(c->assets[i]);
    for (i = 0; i < c->nProgs; i++) free_prog(c->progs[i]);
    free(c->assets);
    free(c->progs);
    memset(c, 0, sizeof *c);
}

asset_entry *cache_asset(cache *c, const char *id) {
    int i;
    if (!id) return NULL;
    for (i = 0; i < c->nAssets; i++) if (!strcmp(c->assets[i]->id, id)) return c->assets[i];
    return NULL;
}

prog_entry *cache_prog(cache *c, const char *id) {
    int i;
    if (!id) return NULL;
    for (i = 0; i < c->nProgs; i++) if (!strcmp(c->progs[i]->id, id)) return c->progs[i];
    return NULL;
}

int cache_known(cache *c, const char *id) {
    return cache_asset(c, id) != NULL || cache_prog(c, id) != NULL;
}

static int grow(void ***arr, int *cap, int n) {
    void **p;
    if (n < *cap) return 0;
    *cap = *cap ? *cap * 2 : 8;
    p = (void **)realloc(*arr, (size_t)*cap * sizeof(void *));
    if (!p) return -1;
    *arr = p;
    return 0;
}

asset_entry *cache_add_asset(cache *c, const char *id, int kind, int dims, int size,
                             uint8_t *data, size_t len) {
    asset_entry *a = cache_asset(c, id);
    if (a) { free(data); return a; } /* content addressed: the same id is the same bytes */
    if (grow((void ***)&c->assets, &c->capAssets, c->nAssets) < 0) return NULL;
    a = (asset_entry *)calloc(1, sizeof *a);
    if (!a) return NULL;
    snprintf(a->id, sizeof a->id, "%s", id);
    a->kind = kind;
    a->dims = dims;
    a->size = size;
    a->data = data;
    a->len = len;
    c->assets[c->nAssets++] = a;
    c->assetBytes += len;
    return a;
}

prog_entry *cache_add_prog(cache *c, const char *id, char *frag, char (*names)[32], int nNames) {
    prog_entry *p = cache_prog(c, id);
    if (p) { free(frag); return p; }
    if (grow((void ***)&c->progs, &c->capProgs, c->nProgs) < 0) return NULL;
    p = (prog_entry *)calloc(1, sizeof *p);
    if (!p) return NULL;
    snprintf(p->id, sizeof p->id, "%s", id);
    p->frag = frag;
    p->nUniforms = nNames;
    if (nNames > 0) {
        p->uniforms = (char (*)[32])malloc((size_t)nNames * 32);
        if (!p->uniforms) { free(p); return NULL; }
        memcpy(p->uniforms, names, (size_t)nNames * 32);
    }
    c->progs[c->nProgs++] = p;
    return p;
}

void cache_prog_fail(prog_entry *p, const char *log) {
    free(p->log);
    p->log = strdup(log ? log : "unknown error");
    p->ok = 0;
}

void cache_evict(cache *c, const char *const *keepIds, int nKeep,
                 void (*releaseGl)(asset_entry *, void *), void *user) {
    int i;
    /* Oldest first: the bound layer's assets were re-sent most recently, and the keep list
     * protects them regardless. */
    for (i = 0; i < c->nAssets && c->assetBytes > c->maxAssetBytes; ) {
        asset_entry *a = c->assets[i];
        int keep = 0, k;
        for (k = 0; k < nKeep; k++) if (keepIds[k] && !strcmp(a->id, keepIds[k])) { keep = 1; break; }
        if (keep) { i++; continue; }
        if (releaseGl) releaseGl(a, user);
        c->assetBytes -= a->len;
        free_asset(a);
        memmove(&c->assets[i], &c->assets[i + 1], (size_t)(c->nAssets - i - 1) * sizeof(asset_entry *));
        c->nAssets--;
    }
}
