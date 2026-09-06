#include "compile_guard.h"
#include "cache.h"
#include "render.h"

#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>

/* Wire between parent and helper. Deliberately trivial: one request in flight, length prefixed
 * both ways, no JSON. The helper is ours and is restarted on any confusion, so there is nothing to
 * negotiate and nothing worth being tolerant about. */
enum { REPLY_OK = 0, REPLY_COMPILE = 1, REPLY_LINK = 2, REPLY_NO_RENDERER = 3 };
enum { MAX_FRAG = 1 << 20, MAX_LOG = 4096 };

#define DEFAULT_TIMEOUT_MS 30000

/* Writing to a socket whose peer has died raises SIGPIPE, and the default disposition for that is
 * to kill the process. This file exists to stop a dead child killing the parent, so it must not
 * depend on the caller having ignored the signal - main.c happens to, and relying on that would
 * make the guard correct only by luck. Linux takes MSG_NOSIGNAL per send; macOS wants
 * SO_NOSIGPIPE on the socket instead, which spawn() sets. (Found by selftest.c, which does not
 * ignore SIGPIPE and died on exactly this.) */
#ifdef MSG_NOSIGNAL
#define CG_SEND_FLAGS MSG_NOSIGNAL
#else
#define CG_SEND_FLAGS 0
#endif

/* A short write is normal on a socket; a partial message is not, so both directions loop. */
static int write_all(int fd, const void *buf, size_t n) {
    const char *p = (const char *)buf;
    while (n > 0) {
        ssize_t k = send(fd, p, n, CG_SEND_FLAGS);
        if (k < 0) { if (errno == EINTR) continue; return -1; }
        if (k == 0) return -1;
        p += k; n -= (size_t)k;
    }
    return 0;
}

static int read_all(int fd, void *buf, size_t n) {
    char *p = (char *)buf;
    while (n > 0) {
        ssize_t k = read(fd, p, n);
        if (k < 0) { if (errno == EINTR) continue; return -1; }
        if (k == 0) return -1; /* the helper is gone: EOF is how a crash reaches us */
        p += k; n -= (size_t)k;
    }
    return 0;
}

/* Wait for readability with a deadline, so a compiler that hangs rather than crashing cannot wedge
 * the render loop forever. Returns 1 readable, 0 timed out, -1 error. */
static int wait_readable(int fd, int timeoutMs) {
    struct pollfd pfd;
    pfd.fd = fd;
    pfd.events = POLLIN;
    for (;;) {
        int n = poll(&pfd, 1, timeoutMs);
        if (n < 0 && errno == EINTR) continue; /* the 1 Hz telemetry tick lands here */
        if (n < 0) return -1;
        return n > 0 ? 1 : 0;
    }
}

/* ---- the helper ------------------------------------------------------------------------------
 * Never returns. One renderer, created once, then a compile per request. render_create and
 * render_build_program are the SAME functions the parent will use, called the same way, which is
 * the whole point: a probe that compiled differently from the real thing could pass and let the
 * parent crash anyway. */
static void helper_loop(int fd, const char *node, int w, int h) {
    char err[256];
    /* Same size as the parent, so the aspect softening in build_geometry and the framebuffer the
     * draw below runs against are identical. One less way for the two to differ. */
    renderer *r = render_create(node, w, h, err, sizeof err);
    /* The probe DRAWS, so it needs somewhere to read back into. See the header: compiling and
     * linking is not enough, because v3d does the real work at the first draw. */
    uint8_t *rgba = r ? (uint8_t *)malloc((size_t)w * h * 4) : NULL;
    if (r && !rgba) { render_destroy(r); r = NULL; snprintf(err, sizeof err, "out of memory"); }

    for (;;) {
        uint32_t len = 0, status, loglen;
        char *frag;
        prog_entry p;
        int isLink = 0;
        const char *log;

        if (read_all(fd, &len, sizeof len) < 0) break; /* parent gone: so are we */
        if (len == 0 || len > MAX_FRAG) break;
        frag = (char *)malloc(len + 1);
        if (!frag) break;
        if (read_all(fd, frag, len) < 0) { free(frag); break; }
        frag[len] = 0;

        if (!r) {
            status = REPLY_NO_RENDERER;
            log = err;
        } else {
            memset(&p, 0, sizeof p);
            p.frag = frag;
            /* nUniforms 0: the uniform list is checked structurally by glsl_check_program before
             * this is ever called, and a location lookup cannot be what crashes the compiler. */
            if (render_build_program(r, &p, &isLink) < 0) {
                status = isLink ? REPLY_LINK : REPLY_COMPILE;
                log = p.log ? p.log : "the driver rejected it and gave no log";
            } else if (render_frame(r, &p, NULL, 0, NULL, 0, rgba, err, sizeof err) < 0) {
                /* A GL error at draw time is still "this program does not work here", and the
                 * caller wants that as a compile failure rather than as a broken picture. */
                status = REPLY_COMPILE;
                log = err;
            } else {
                status = REPLY_OK;
                log = "";
            }
        }
        loglen = (uint32_t)strlen(log);
        if (loglen > MAX_LOG) loglen = MAX_LOG;
        if (write_all(fd, &status, sizeof status) < 0) break;
        if (write_all(fd, &loglen, sizeof loglen) < 0) break;
        if (loglen && write_all(fd, log, loglen) < 0) break;

        if (r) {
            /* Every probe is thrown away. Without this the helper would accumulate one GL program
             * per live edit for the life of the daemon. */
            render_release_program(r, &p);
            free(p.log);
        }
        free(frag);
    }
    _exit(0);
}

/* ---- parent ---------------------------------------------------------------------------------- */

static void spawn(cguard *g) {
    int sv[2];
    pid_t pid;

    g->pid = 0;
    g->fd = -1;
    if (socketpair(AF_UNIX, SOCK_STREAM, 0, sv) < 0) return;
#ifdef SO_NOSIGPIPE
    { int on = 1;
      setsockopt(sv[0], SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof on);
      setsockopt(sv[1], SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof on); }
#endif
    pid = fork();
    if (pid < 0) { close(sv[0]); close(sv[1]); return; }
    if (pid == 0) {
        close(sv[0]);
        /* The parent's handlers exist to shut the daemon down cleanly; in here they would shut
         * down half a daemon. And SIGSEGV must stay fatal and reportable - it is the signal this
         * whole file exists to catch. */
        signal(SIGINT, SIG_DFL);
        signal(SIGTERM, SIG_DFL);
        signal(SIGPIPE, SIG_DFL);
        helper_loop(sv[1], g->node, g->w, g->h);
        _exit(0); /* not reached */
    }
    close(sv[1]);
    g->pid = pid;
    g->fd = sv[0];
}

/* Reap the helper and say how it went, for the log line the caller sends back to limut. */
static void reap(cguard *g, char *how, size_t howCap) {
    int st = 0;
    pid_t r;
    if (g->fd >= 0) { close(g->fd); g->fd = -1; }
    if (g->pid <= 0) { snprintf(how, howCap, "the shader compiler helper was not running"); return; }
    kill(g->pid, SIGKILL); /* a no-op if it is already dead, and what ends a hang */
    do { r = waitpid(g->pid, &st, 0); } while (r < 0 && errno == EINTR);
    g->pid = 0;
    if (r > 0 && WIFSIGNALED(st)) {
        snprintf(how, howCap, "signal %d (%s)", WTERMSIG(st), strsignal(WTERMSIG(st)));
    } else {
        snprintf(how, howCap, "it exited without answering");
    }
}

void cguard_start(cguard *g, const char *node, int w, int h) {
    memset(g, 0, sizeof *g);
    g->fd = -1;
    g->w = w;
    g->h = h;
    g->timeoutMs = DEFAULT_TIMEOUT_MS;
    snprintf(g->node, sizeof g->node, "%s", node ? node : "");
    spawn(g);
}

void cguard_stop(cguard *g) {
    int st;
    if (g->fd >= 0) { close(g->fd); g->fd = -1; }
    if (g->pid > 0) {
        kill(g->pid, SIGTERM);
        while (waitpid(g->pid, &st, 0) < 0 && errno == EINTR) {}
        g->pid = 0;
    }
}

int cguard_active(const cguard *g) { return g->pid > 0 && g->fd >= 0; }

int cguard_check(cguard *g, const char *frag, int *isLink, char *log, size_t logCap) {
    uint32_t len, status = 0, loglen = 0;
    char how[128];
    size_t n;

    *isLink = 0;
    if (!cguard_active(g)) return CGUARD_NONE;
    n = strlen(frag);
    if (n == 0 || n > MAX_FRAG) return CGUARD_NONE; /* nothing this file can usefully say */
    g->checks++;
    len = (uint32_t)n;

    if (write_all(g->fd, &len, sizeof len) < 0 || write_all(g->fd, frag, n) < 0) goto died;
    if (wait_readable(g->fd, g->timeoutMs) != 1) {
        g->crashes++;
        reap(g, how, sizeof how);
        spawn(g);
        snprintf(g->lastCrash, sizeof g->lastCrash,
                 "the compile helper did not finish within %d seconds and was stopped",
                 g->timeoutMs / 1000);
        snprintf(log, logCap, "too slow for the GPU's shader compiler; simplify the chain");
        return CGUARD_CRASHED;
    }
    if (read_all(g->fd, &status, sizeof status) < 0) goto died;
    if (read_all(g->fd, &loglen, sizeof loglen) < 0) goto died;
    if (loglen > MAX_LOG) goto died;
    if (loglen) {
        char *buf = (char *)malloc(loglen + 1);
        if (!buf) goto died;
        if (read_all(g->fd, buf, loglen) < 0) { free(buf); goto died; }
        buf[loglen] = 0;
        snprintf(log, logCap, "%s", buf);
        free(buf);
    } else {
        log[0] = 0;
    }

    if (status == REPLY_OK) return CGUARD_OK;
    if (status == REPLY_NO_RENDERER) return CGUARD_NONE;
    *isLink = (status == REPLY_LINK);
    return CGUARD_REJECT;

died:
    /* The read failed or the socket closed mid-answer, which is what a SIGSEGV in the driver looks
     * like from here.
     * `log` goes back over the wire and is read in the limut console by someone in the middle of
     * playing: it gets one short line saying what is wrong and what to change, and nothing else.
     * The signal, and the fact that a *crash* rather than a rejection is what happened, go to the
     * daemon's own log - that is diagnosis, and diagnosis is not what a live coder needs from a
     * shader that just failed. */
    g->crashes++;
    reap(g, how, sizeof how);
    spawn(g);
    snprintf(g->lastCrash, sizeof g->lastCrash, "the compile helper died with %s", how);
    snprintf(log, logCap, "too complex for the GPU's shader compiler; simplify the chain");
    return CGUARD_CRASHED;
}
