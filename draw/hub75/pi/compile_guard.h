/* compile_guard.h - compile a candidate shader in a child process, so a driver bug cannot kill
 * the display.
 *
 * Mesa's v3d compiler SEGFAULTS on shaders it cannot register allocate, rather than returning a
 * compile error (2026-09-06; see ../CLAUDE.md). Compiling on the render thread therefore made a
 * px chain able to kill the daemon: systemd restarted it, limut resent the same program, and it
 * died again, forever. The whole of §8's error reporting assumes a failed compile RETURNS.
 *
 * So the compile is tried first in a forked helper that holds its own GL context and does nothing
 * else. If it dies, the parent survives and turns the death into an ordinary `error kind:"compile"`
 * - which is permanent for that source (§8), so limut stops resending it and the loop is broken at
 * the same time as the crash.
 *
 * IT MUST DRAW, not merely compile and link. v3d generates the hardware fragment code lazily, at
 * the first draw with the real pipeline state - so a helper that only called glCompileShader and
 * glLinkProgram reported the fire shader as perfectly fine and the parent died on the next frame
 * a second later. Measured 2026-09-06, and it is the whole reason this file's helper has a
 * framebuffer. A guard that stops short of the work it is guarding is worse than none: it says
 * "compiles guarded" in the banner and guards nothing.
 *
 * The helper is forked BEFORE the parent creates its own EGL context. Mesa is not fork-safe, and a
 * child that inherited a live GL context would be a second bug rather than a fix for the first.
 * It is long lived: one context, reused for every compile, so the cost is one fork at startup
 * rather than an EGL setup per program.
 *
 * The portable half - fork, framing, crash detection - is always built, so the crash path is
 * testable on a machine with no GPU. Where render.c has no GLES the helper simply reports that it
 * has no renderer and the caller compiles directly, exactly as it did before.
 */
#ifndef HUB75_COMPILE_GUARD_H
#define HUB75_COMPILE_GUARD_H

#include <stddef.h>
#include <sys/types.h>

typedef struct {
    pid_t pid;         /* 0 when no helper is running */
    int   fd;          /* socketpair to the helper, -1 when none */
    char  node[128];   /* render node, so a crashed helper can be respawned */
    int   w, h;
    int   crashes;     /* helpers lost to a signal, for the startup/status line */
    int   checks;      /* programs put through it */
    int   timeoutMs;
    /* Why the last helper died, in full. This stays on the Pi: the message that goes back over the
     * wire is read by someone mid-performance and has to be one short line, so the signal number
     * and the driver's own noise belong in the daemon's log instead. */
    char  lastCrash[160];
} cguard;

/* Results of cguard_check. */
enum {
    CGUARD_OK      =  0, /* it compiles and links; the caller may now build it for real */
    CGUARD_REJECT  = -1, /* the driver rejected it, `log` holds the driver's own words */
    CGUARD_CRASHED = -2, /* the compiler died or hung on it; `log` says so. Permanent, like -1 */
    CGUARD_NONE    = -3  /* no helper (no GPU, or it could not be started): compile directly */
};

/* Forks the helper. Never fatal: on failure the guard is simply inactive and cguard_check returns
 * CGUARD_NONE, which restores the pre-2026-09-06 behaviour rather than refusing to run. */
void cguard_start(cguard *g, const char *node, int w, int h);
void cguard_stop(cguard *g);
int  cguard_active(const cguard *g);

/* Try `frag` in the helper. `isLink` distinguishes §8's "compile" from "link" for the reject case.
 * A crash or a hang is CGUARD_CRASHED and the helper is respawned for the next program. */
int cguard_check(cguard *g, const char *frag, int *isLink, char *log, size_t logCap);

#endif
