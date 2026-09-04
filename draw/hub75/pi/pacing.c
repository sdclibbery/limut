/* pacing.c - see pacing.h. */
#include "pacing.h"

#include <string.h>

int pace_bucket(double secs) {
    double f = secs / PACE_FRAME;
    if (f < PACE_EDGE0) return 0;
    if (f < PACE_EDGE1) return 1;
    if (f < PACE_EDGE2) return 2;
    if (f < PACE_EDGE3) return 3;
    return 4;
}

void pace_init(pace_stat *p) {
    memset(p, 0, sizeof *p);
    p->prev = -1.0;
}

void pace_reset(pace_stat *p) {
    double prev = p->prev;
    memset(p, 0, sizeof *p);
    p->prev = prev;
}

void pace_add(pace_stat *p, double secs) {
    /* A negative interval means the clock went backwards or a caller passed a duration it had not
     * actually measured. Counting it would corrupt the mean silently; dropping it is honest. */
    if (secs < 0.0) return;
    p->n++;
    p->sum += secs;
    if (secs > p->max) p->max = secs;
    p->bucket[pace_bucket(secs)]++;
}

void pace_mark(pace_stat *p, double now) {
    if (p->prev >= 0.0) pace_add(p, now - p->prev);
    p->prev = now;
}

void pace_json(strbuf *b, const char *name, const pace_stat *p) {
    int i;
    sb_addf(b, "\"%s\":{\"n\":%u,\"mean\":", name, p->n);
    sb_json_num(b, p->n ? p->sum / p->n * 1000.0 : 0.0);
    sb_add(b, ",\"max\":");
    sb_json_num(b, p->max * 1000.0);
    sb_add(b, ",\"b\":[");
    for (i = 0; i < PACE_BUCKETS; i++) sb_addf(b, "%s%u", i ? "," : "", p->bucket[i]);
    sb_add(b, "]}");
}

void pace_set_init(pace_set *s) {
    pace_init(&s->host);
    pace_init(&s->arrive);
    pace_init(&s->draw);
    pace_init(&s->render);
    s->seqGaps = 0;
    s->seqSkipped = 0;
}

void pace_set_roll(pace_set *live, pace_set *out) {
    *out = *live;
    /* pace_reset rather than pace_init: `prev` has to survive, or the first gap of the new window
     * would be measured from zero and land in the stall bucket every single second. */
    pace_reset(&live->host);
    pace_reset(&live->arrive);
    pace_reset(&live->draw);
    pace_reset(&live->render);
    live->seqGaps = 0;
    live->seqSkipped = 0;
}

void pace_set_json(strbuf *b, const pace_set *s) {
    sb_add(b, "{");
    pace_json(b, "host", &s->host);
    sb_add(b, ",");
    pace_json(b, "arrive", &s->arrive);
    sb_add(b, ",");
    pace_json(b, "draw", &s->draw);
    sb_add(b, ",");
    pace_json(b, "render", &s->render);
    sb_addf(b, ",\"seqGaps\":%u,\"seqSkipped\":%u}", s->seqGaps, s->seqSkipped);
}
