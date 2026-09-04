/* pacing.h - per-second distributions of the intervals that decide whether the wall looks smooth.
 *
 * The wall is paced entirely by packet arrival: main.c drains the socket, then draws once, and
 * §12.1's last-write-wins throws away everything a burst delivered except the newest. So a frame
 * that arrives late, or bunched with its neighbour, is a visible jerk rather than something the
 * daemon can absorb — and until this file existed nothing measured that. `fps` is a whole-second
 * count, so a second containing a 100 ms stall and then a catch-up burst still reads 59; and
 * `renderMs` was the last frame's value, which samples one frame in fifty and averages a periodic
 * spike out of existence entirely.
 *
 * Four series, answering four different questions. The frame packet already carries what the
 * first two need (PROTOCOL.md §12.1 `seq` and `hostTime`), so none of this changes the wire
 * format:
 *
 *   host    hostTime deltas    limut's own send cadence, immune to the network
 *   arrive  local arrival      what the network actually delivered
 *   draw    display_draw       what the wall actually saw
 *   render  render duration    how much of the frame budget the GPU and output stage ate
 *
 * Comparing `host` against `arrive` is the decisive one, and it is the reason `hostTime` is
 * decoded at all: regular sends with irregular arrivals is the network, irregular sends is limut
 * (an rAF stall, Electron throttling, or the host's own bufferedAmount skip).
 *
 * Fixed size and allocation-free by construction. This sits on the 60 Hz path, where an earlier
 * `vcgencmd` fork cost a 21 ms renderMs spike — 30x a normal frame. See ../CLAUDE.md.
 */
#ifndef HUB75_PACING_H
#define HUB75_PACING_H

#include "json.h"

/* One frame at 60 Hz. Intervals are bucketed in these rather than in milliseconds so the numbers
 * read the same way the problem does: "one frame" is healthy whatever the rate turns out to be. */
#define PACE_FRAME   (1.0 / 60.0)
#define PACE_BUCKETS 5

/* Bucket edges, in frame times. Centred on 1 rather than starting at it, because the interesting
 * distinction is early/on-time/late, not above/below: a gap of exactly one frame is the healthy
 * case and must not sit on a boundary where jitter of a microsecond flips it between buckets.
 *
 *   0  < 0.75   early    - arrived sooner than the cadence implies, i.e. bunched with its
 *                          neighbour. These are the arrivals that become dropped frames.
 *   1  0.75-1.5 ontime   - the healthy bucket. A regular feed is almost entirely this.
 *   2  1.5-2.5  late1    - one frame missed
 *   3  2.5-5    late2    - a short stall
 *   4  >= 5     stall    - 83 ms or more; a visible freeze
 */
#define PACE_EDGE0 0.75
#define PACE_EDGE1 1.5
#define PACE_EDGE2 2.5
#define PACE_EDGE3 5.0

typedef struct {
    double   prev;                  /* timestamp of the previous sample; < 0 before the first */
    unsigned n;
    double   sum, max;              /* seconds */
    unsigned bucket[PACE_BUCKETS];
} pace_stat;

/* Which bucket an interval falls in. Exposed so the tests can check the edges directly. */
int  pace_bucket(double secs);

/* Clear everything, including any memory of a previous sample. */
void pace_init(pace_stat *p);

/* Clear the window at the end of a reporting period. Deliberately keeps `prev`, so the first gap
 * of the new second is a real interval rather than a spurious one measured from zero. */
void pace_reset(pace_stat *p);

/* Record an interval, or a duration, that the caller already has. */
void pace_add(pace_stat *p, double secs);

/* Record the interval since the last mark, then remember `now`. The first call after an init only
 * establishes the baseline and records nothing. */
void pace_mark(pace_stat *p, double now);

/* `"name":{"n":..,"mean":..,"max":..,"b":[..]}` — milliseconds, matching renderMs. */
void pace_json(strbuf *b, const char *name, const pace_stat *p);

/* The four series plus the host-skip count, as one window.
 *
 * Two of these are kept: the window in progress, and the last completed one. /debug is served on
 * request at any moment, so reporting the live window would hand back whatever fraction of a
 * second had elapsed since the last tick — a reading that changes meaning depending on when it is
 * taken. Both routes read the completed window instead, so a number is always a whole second. */
typedef struct {
    pace_stat host, arrive, draw, render;
    unsigned  seqGaps;      /* frames the host did not send: seq jumps over 1 (§12.1) */
    unsigned  seqSkipped;   /* how many frames those gaps account for */
} pace_set;

void pace_set_init(pace_set *s);

/* End the window: copy it to `out` and start a new one. Called once a second by display_tick. */
void pace_set_roll(pace_set *live, pace_set *out);

/* `"pacing":{"host":{..},"arrive":{..},"draw":{..},"render":{..},"seqGaps":n,"seqSkipped":n}` */
void pace_set_json(strbuf *b, const pace_set *s);

#endif
