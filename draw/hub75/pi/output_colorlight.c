/* output_colorlight.c - the Colorlight 5A-75B output stage.
 *
 * NOT IMPLEMENTED. This file is the seam it will fill, kept separate so that what remains is
 * visible as a file rather than buried in a branch of output.c.
 *
 * What it has to do:
 *
 *   - frame the RGB image in the Colorlight receiving card's own protocol: row packets with
 *     per-row addressing, plus whatever brightness and frame-sync packets the card expects
 *   - send them as RAW LAYER 2 FRAMES on eth0 with AF_PACKET. The card does not speak IP, it
 *     takes broadcast ethernet frames, which is why eth0 is configured unmanaged with no DHCP
 *     and no address, and why the systemd unit grants CAP_NET_RAW
 *
 * What it does NOT have to do, on current assumptions:
 *
 *   - panel mapping. The 5A-75B is flashed with a receiving-card configuration describing the
 *     panel array, so it maps a rectangular image onto the chain itself. If bring-up shows the
 *     card cannot express the layout, mapping becomes a pixel permutation applied here, before
 *     framing — the pixels arrive as a plain top-row-first RGBA8 image of exactly panel size.
 *   - the dimmer or gamma. output.c has already applied both by the time write() is called
 *     (PROTOCOL.md §9), so o->pixels is the final image.
 *
 * The protocol is not documented by Colorlight and nothing in this repo describes it yet.
 * Working it out is its own task: capture what LEDVision sends over the wire, and cross-check
 * against the open-source implementations that exist.
 */
#include "output.h"
#include <stdio.h>

int output_colorlight_write(output_t *o) {
    static int warned = 0;
    (void)o;
    if (!warned) {
        warned = 1;
        fprintf(stderr,
                "🔴 the colorlight output stage is not implemented — frames are being discarded.\n"
                "   Everything upstream of it works and is verifiable with --output raw.\n"
                "   See draw/hub75/pi/output_colorlight.c.\n");
    }
    return 0;
}

void output_colorlight_shutdown(output_t *o) { (void)o; }
