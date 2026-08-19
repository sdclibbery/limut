/* main.c - the limut HUB75 display daemon.
 *
 *   limut-hub75 --name hub75-01 --size 128x64 --output raw
 *
 * The loop is deliberately one thread with the render inline, and that falls straight out of
 * §12.1's last-write-wins rule:
 *
 *   1. drain every readable byte and dispatch it; frame packets overwrite a single pending slot
 *   2. if a frame is pending, render it, read it back, and push it to the output stage
 *   3. once a second, send stat and ping
 *
 * Draining fully before drawing is what makes last-write-wins free: a frame superseded before it
 * was drawn is never queued, only counted. If render and readback ever fall behind the host's
 * rAF, the loop degrades by dropping frames, which is the specified behaviour rather than a
 * failure — stat.renderMs is there to say when that starts.
 */
#include "display.h"
#include "net.h"
#include "patterns.h"

#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static volatile sig_atomic_t stopping = 0;

static void on_signal(int sig) { (void)sig; stopping = 1; }

static const char *USAGE =
    "limut HUB75 display\n"
    "\n"
    "  --port N            listen port (default 7575)\n"
    "  --name NAME         display name reported by /info and welcome (default hub75-01)\n"
    "  --size WxH          panel resolution (default 128x64)\n"
    "  --node PATH         DRM render node (default /dev/dri/renderD128)\n"
    "  --output BACKEND    null | raw | colorlight (default raw)\n"
    "  --gamma G           output gamma, applied after the dimmer (default 2.2;\n"
    "                      use 1 for pixel comparisons against the browser)\n"
    "  --no-gpu            do not open a renderer, even if one is available\n"
    "  --verbose, -v       log every message instead of a one line status\n"
    "\n"
    "The flags mirror draw/hub75/mock/display.js so the two are interchangeable.\n";

int main(int argc, char **argv) {
    display d;
    netserver net;
    char err[512];
    const char *backend = "raw";
    int noGpu = 0, i;
    double nextTick;

    memset(&d, 0, sizeof d);
    snprintf(d.name, sizeof d.name, "hub75-01");
    snprintf(d.node, sizeof d.node, "/dev/dri/renderD128");
    d.port = 7575;
    d.w = 128;
    d.h = 64;
    d.gamma = 2.2f;
    d.maxTextureSize = 4096;

    for (i = 1; i < argc; i++) {
        const char *k = argv[i], *v = (i + 1 < argc) ? argv[i + 1] : NULL;
        if (!strcmp(k, "--port") && v) { d.port = atoi(v); i++; }
        else if (!strcmp(k, "--name") && v) { snprintf(d.name, sizeof d.name, "%s", v); i++; }
        else if (!strcmp(k, "--node") && v) { snprintf(d.node, sizeof d.node, "%s", v); i++; }
        else if (!strcmp(k, "--output") && v) { backend = v; i++; }
        else if (!strcmp(k, "--gamma") && v) { d.gamma = (float)atof(v); i++; }
        else if (!strcmp(k, "--no-gpu")) { noGpu = 1; }
        else if (!strcmp(k, "--verbose") || !strcmp(k, "-v")) { d.verbose = 1; }
        else if (!strcmp(k, "--help") || !strcmp(k, "-h")) { fputs(USAGE, stdout); return 0; }
        else if (!strcmp(k, "--size") && v) {
            if (sscanf(v, "%dx%d", &d.w, &d.h) != 2 || d.w <= 0 || d.h <= 0) {
                fprintf(stderr, "🔴 --size wants WxH, eg 128x64\n");
                return 2;
            }
            i++;
        } else {
            fprintf(stderr, "🔴 unknown argument %s\n\n%s", k, USAGE);
            return 2;
        }
    }

    /* A write to a socket the peer just closed must not take the process down with it — that is
     * an ordinary event here, not an error. */
    signal(SIGPIPE, SIG_IGN);
    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);

    if (!noGpu) {
        d.r = render_create(d.node, d.w, d.h, err, sizeof err);
        if (!d.r) {
            /* Not fatal: the protocol, the caches, the test patterns and the output stage all
             * work without one, which is exactly the mock's job and is worth keeping. */
            fprintf(stderr, "🟡 no renderer: %s\n"
                            "   Running without a GPU: shaders are checked structurally but "
                            "nothing is drawn.\n", err);
        } else {
            d.maxTextureSize = render_max_texture_size(d.r);
        }
    }

    if (output_open(&d.out, backend, d.w, d.h, d.gamma, err, sizeof err) < 0) {
        fprintf(stderr, "🔴 %s\n", err);
        return 1;
    }
    if (display_init(&d, err, sizeof err) < 0) {
        fprintf(stderr, "🔴 %s\n", err);
        return 1;
    }
    if (net_start(&net, &d, d.port, err, sizeof err) < 0) {
        fprintf(stderr, "🔴 %s\n", err);
        return 1;
    }

    printf("limut HUB75 display \"%s\" %dx%d on port %d\n", d.name, d.w, d.h, d.port);
    printf("  info    http://localhost:%d/info\n", d.port);
    printf("  session ws://localhost:%d/session\n", d.port);
    printf("  frame   http://localhost:%d/frame.raw   (debug, not part of the protocol)\n", d.port);
    printf("  gl      %s / %s\n", render_gl_version(d.r), render_gl_renderer(d.r));
    printf("  output  %s, gamma %g\n", d.out.backend, (double)d.gamma);
    fflush(stdout);

    nextTick = now_seconds() + 1.0;
    while (!stopping) {
        double now = now_seconds();
        int timeout = (int)((nextTick - now) * 1000.0);
        if (timeout < 0) timeout = 0;
        if (timeout > 1000) timeout = 1000;

        net_poll(&net, timeout);   /* 1: drain and dispatch */
        display_draw(&d);          /* 2: render whatever survived */

        now = now_seconds();
        if (now >= nextTick) {     /* 3: telemetry */
            display_tick(&d, now);
            nextTick = now + 1.0;
            if (!d.verbose && isatty(1)) {
                printf("\rhub75 %s %dx%d  %s  seq %lld  %dfps  drop %llu  dim %.2f  "
                       "layer %s  assets %d  progs %d  %.1fC   ",
                       d.name, d.w, d.h, d.conn ? d.sessionId : "no session", d.lastSeq,
                       d.fps, d.dropped, (double)d.dim,
                       d.layerBound ? d.layerProg : (d.testPattern != PATTERN_OFF
                                                     ? pattern_name(d.testPattern) : "-"),
                       d.cache.nAssets, d.cache.nProgs, d.temp);
                fflush(stdout);
            }
        }
    }

    printf("\nstopping\n");
    net_stop(&net);
    display_free(&d);
    return 0;
}
