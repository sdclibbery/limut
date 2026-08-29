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
    "  --iface NAME        colorlight: interface the card is cabled to (default eth0)\n"
    "  --color-order ORD   colorlight: byte order the panels want, eg bgr (default rgb)\n"
    "  --brightness N      colorlight: the card's own panel brightness, 0-255 (default 255)\n"
    "  --row-map N         colorlight: 1 (default) if canvas rows land on panel rows 1:1; 2 if\n"
    "                      the card drives twice the scan lines the panel decodes, so two canvas\n"
    "                      rows superimpose. --size stays the size you want to SEE\n"
    "  --panel-rows N      colorlight: physical rows in one panel, setting the row-map group\n"
    "                      (default 32)\n"
    "  --canvas WxH        colorlight: the card's whole canvas, if it is bigger than what we\n"
    "                      render (default: same as --size)\n"
    "  --offset X,Y        colorlight: where the render sits in that canvas; the rest is sent\n"
    "                      black (default 0,0)\n"
    "  --test-pattern NAME off | bars | grid | white | red | green | blue | map | rowid |\n"
    "                      bands\n"
    "                      until a host binds a layer. `map` numbers each 64x32 cell of the\n"
    "                      canvas, so a lit panel says where in the canvas it is wired\n"
    "  --pattern-fps N     rate to re-send a test pattern at, with no host driving it\n"
    "                      (default 60; 0 sends it once and stops)\n"
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
    output_opts opts;
    int noGpu = 0, i, testPattern = PATTERN_OFF;
    double patternFps = 60.0, nextPattern;
    double nextTick;

    memset(&d, 0, sizeof d);
    snprintf(d.name, sizeof d.name, "hub75-01");
    snprintf(d.node, sizeof d.node, "/dev/dri/renderD128");
    d.port = 7575;
    d.w = 128;
    d.h = 64;
    d.gamma = 2.2f;
    d.maxTextureSize = 4096;

    memset(&opts, 0, sizeof opts);
    opts.iface = "eth0";
    opts.colorOrder = "rgb";
    opts.brightness = 255;
    opts.rowMap = 1;
    opts.panelRows = 32;
    opts.canvasW = opts.canvasH = 0;
    opts.offsetX = opts.offsetY = 0;

    for (i = 1; i < argc; i++) {
        const char *k = argv[i], *v = (i + 1 < argc) ? argv[i + 1] : NULL;
        if (!strcmp(k, "--port") && v) { d.port = atoi(v); i++; }
        else if (!strcmp(k, "--name") && v) { snprintf(d.name, sizeof d.name, "%s", v); i++; }
        else if (!strcmp(k, "--node") && v) { snprintf(d.node, sizeof d.node, "%s", v); i++; }
        else if (!strcmp(k, "--output") && v) { backend = v; i++; }
        else if (!strcmp(k, "--iface") && v) { opts.iface = v; i++; }
        else if (!strcmp(k, "--color-order") && v) { opts.colorOrder = v; i++; }
        else if (!strcmp(k, "--brightness") && v) { opts.brightness = atoi(v); i++; }
        else if (!strcmp(k, "--row-map") && v) { opts.rowMap = atoi(v); i++; }
        else if (!strcmp(k, "--panel-rows") && v) { opts.panelRows = atoi(v); i++; }
        else if (!strcmp(k, "--canvas") && v) {
            if (sscanf(v, "%dx%d", &opts.canvasW, &opts.canvasH) != 2) {
                fprintf(stderr, "🔴 --canvas wants WxH, eg 1280x256\n");
                return 2;
            }
            i++;
        }
        else if (!strcmp(k, "--offset") && v) {
            if (sscanf(v, "%d,%d", &opts.offsetX, &opts.offsetY) != 2) {
                fprintf(stderr, "🔴 --offset wants X,Y, eg 1088,0\n");
                return 2;
            }
            i++;
        }
        else if (!strcmp(k, "--pattern-fps") && v) { patternFps = atof(v); i++; }
        else if (!strcmp(k, "--test-pattern") && v) {
            testPattern = pattern_by_name(v);
            if (testPattern < 0) {
                fprintf(stderr, "🔴 unknown test pattern '%s' — off, bars or grid\n", v);
                return 2;
            }
            i++;
        }
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

    if (output_open(&d.out, backend, d.w, d.h, d.gamma, &opts, err, sizeof err) < 0) {
        fprintf(stderr, "🔴 %s\n", err);
        return 1;
    }
    if (display_init(&d, err, sizeof err) < 0) {
        fprintf(stderr, "🔴 %s\n", err);
        return 1;
    }
    /* After display_init, which resets it: a pattern asked for on the command line is the
     * starting state, not a default the protocol cannot then override. */
    d.testPattern = testPattern;
    if (net_start(&net, &d, d.port, err, sizeof err) < 0) {
        fprintf(stderr, "🔴 %s\n", err);
        return 1;
    }

    printf("limut HUB75 display \"%s\" %dx%d on port %d (%s)\n", d.name, d.w, d.h, d.port,
           net.dualStack ? "IPv6 and IPv4"
                         : "IPv4 only — a browser preferring the AAAA record will not connect");
    printf("  info    http://localhost:%d/info\n", d.port);
    printf("  session ws://localhost:%d/session\n", d.port);
    printf("  frame   http://localhost:%d/frame.raw   (debug, not part of the protocol)\n", d.port);
    printf("  gl      %s / %s\n", render_gl_version(d.r), render_gl_renderer(d.r));
    printf("  output  %s, gamma %g", d.out.backend, (double)d.gamma);
    if (!strcmp(d.out.backend, "colorlight"))
        printf(" — %s, %d packets/frame steady, colour order %s, brightness %d",
               opts.iface, output_colorlight_packets(&d.out), opts.colorOrder, opts.brightness);
    printf("\n");
    if (d.testPattern != PATTERN_OFF)
        printf("  pattern %s, until a host binds a layer\n", pattern_name(d.testPattern));
    fflush(stdout);

    nextTick = now_seconds() + 1.0;
    nextPattern = now_seconds();
    while (!stopping) {
        double now = now_seconds();
        int timeout = (int)((nextTick - now) * 1000.0);
        /* A test pattern has nothing driving it: display_draw only runs when a frame arrived or
         * something changed, so with no host it would draw once and then go quiet. A receiving
         * card that stops being fed may blank, so re-send on our own clock instead. */
        int freeRun = (d.testPattern != PATTERN_OFF && !d.layerBound && patternFps > 0.0);
        if (timeout < 0) timeout = 0;
        if (timeout > 1000) timeout = 1000;
        if (freeRun) {
            int untilPattern = (int)((nextPattern - now) * 1000.0);
            if (untilPattern < 0) untilPattern = 0;
            if (untilPattern < timeout) timeout = untilPattern;
        }

        net_poll(&net, timeout);   /* 1: drain and dispatch */

        now = now_seconds();
        if (freeRun && now >= nextPattern) {
            d.needsRedraw = 1;
            nextPattern = now + 1.0 / patternFps;
        }

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
