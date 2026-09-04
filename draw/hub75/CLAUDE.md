# HUB75 Display Project

A sub-project of limut, in `draw/hub75`. All of it except `host/` is outside the browser app and
should only be opened when working on the HUB75 project itself. **`draw/hub75/host/` is the
exception**: it is the limut end of the wire protocol and runs in the browser, required by
`draw/visualsynth.js` (the `display` param) and `main.js` (the per-frame uniform stream).
`codec.js` sits at the top level because both ends use it.

## Goal

Build a large LED display out of HUB75 panels and drive it from limut, so that limut visuals
can be rendered onto physical LED panels in real time.

## Hardware chain

```
limut (browser, host machine)
    │  shader source + textures (setup, occasional)
    │  uniform updates (per frame, 60Hz)
    ▼   [network]
Raspberry Pi 4B
    │  renders the shader to a frame buffer
    ▼   [ethernet]
Colorlight 5A-75B receiving card
    │  HUB75 ribbon cables
    ▼
HUB75 LED panel array
```

- **Host / limut** — the existing limut app. Owns the creative content. Sends the shader
  program, any textures it needs, and then a stream of uniform values (time, audio-reactive
  params, player state) at frame rate.
- **Raspberry Pi 4B** — the render node. Receives the shader + textures, compiles it once,
  then renders one frame per uniform update and pushes the resulting pixels out to the
  receiving card. Its GPU and its native gigabit ethernet are both comfortably ahead of what
  this system needs (see Hardware notes below).
- **Colorlight 5A-75B** — an off-the-shelf LED receiving card. Takes frame data over ethernet
  in the Colorlight protocol and does the HUB75 scanning/PWM for the attached panels.
- **HUB75 panels** — the physical display. Panel count, size, and arrangement are part of the
  eventual configuration.

## Scope

Eventually every layer of software in this system is ours to design:

1. **Host side (in limut)** — how a limut visual is nominated for HUB75 output, how its shader
   and textures are extracted, and the transport that ships shader/textures/uniforms to the Pi.
2. **Wire protocol (limut → Pi)** — **specified in `PROTOCOL.md`**, with a working reference
   display in `mock/`. Setup messages (shader, textures, geometry) vs. the 60Hz uniform stream;
   framing, ordering, and what happens on packet loss or a late frame.
3. **Pi renderer** — receive, compile, render offscreen at the panel resolution, read back
   pixels, and hand them to the output stage with a stable 60Hz cadence.
4. **Pi → 5A-75B output** — the Colorlight protocol: frame packets, per-row addressing, colour
   depth/gamma, and getting raw ethernet frames out of the Pi fast enough.
5. **Panel mapping** — mapping the rendered 2D image onto the physical panel layout
   (chains, orientation, receiver port assignment).
6. **Configuration and operation** — describing the display once and having both ends agree,
   plus bring-up/diagnostic modes (test patterns, connectivity checks).

## Hardware notes

The board was originally going to be a Pi 3B+, which had two hard limits: a VideoCore IV GPU
capped at OpenGL ES 2.0, and a "gigabit" port sitting behind USB 2.0. **We are using a Pi 4B
instead, and both limits go away.** Recording why, since it explains design choices that would
otherwise look over-cautious:

**GPU: OpenGL ES 3.1 — verified on hardware.** The 4B has a VideoCore VI driven by Mesa's
`v3d` driver. Measured on the actual board (2026-08-18):

| | |
|---|---|
| `GL_VERSION` | OpenGL ES 3.1 Mesa 26.2.0 |
| `GL_RENDERER` | V3D 4.2.14.0 |
| `GL_SHADING_LANGUAGE_VERSION` | OpenGL ES GLSL ES 3.10 |
| `GL_MAX_TEXTURE_SIZE` | 4096 |
| `GL_MAX_3D_TEXTURE_SIZE` | 4096 |
| `GL_MAX_RENDERBUFFER_SIZE` | 4096 |

`draw/hub75/tools/egl-probe.c` is the probe that established this, and it is worth re-running
after any OS upgrade. It creates a GBM/EGL context on `/dev/dri/renderD128` with **no surface
at all** (`EGL_NO_SURFACE`, so no X and no Wayland), compiles a `#version 300 es` shader pair
that uses `in`/`out`, `texture()` and a `sampler3D`, renders a fullscreen triangle to an FBO,
reads it back with `glReadPixels` and checks the pixel values. All checks pass.

That settles the project's riskiest assumption: limut's shaders are `#version 300 es`
throughout and need no translation layer, and the 3D LUTs in `draw/visualsynth/lut.js` are
supported. **The 4096 texture limit is the one real constraint to design around.**

**Ethernet: native gigabit.** The 4B's MAC is on the SoC rather than hanging off USB, so real
throughput is close to line rate. At roughly 3 bytes per pixel per frame at 60Hz, a gigabit link
is worth very roughly 600k pixels — far more than the panel array is likely to be. The binding
constraint on display size therefore moves to the 5A-75B's own capacity and the panel/scan
configuration, not the network. Check the card's datasheet when fixing the panel count.

**Cooling and power.** Sustained 60Hz GPU load on a 4B needs at least a heatsink, preferably
active cooling, or it will thermally throttle. Use a proper 5V/3A USB-C supply.

Power is worth taking seriously on this project rather than assuming: the red PWR LED is wired
to a voltage supervisor and switches **off** when the 5V rail sags (below roughly 4.63V on a
3B+). A red LED that blinks off and on is therefore an undervoltage warning, not a status code
— and WiFi association is usually where a marginal supply first collapses, which makes a power
fault masquerade as a network fault. Cable quality matters as much as the supply's rating;
thin or long cables drop enough voltage under load to trip it on their own. This bit us during
first bring-up on a stand-in 3B+ (2026-08-17).

## Decisions

**OS: Raspberry Pi OS Lite, 64-bit** (current release). It is the only distro where the
VideoCore GPU stack, firmware, and Mesa are maintained as a tested unit. Lite omits the desktop
but keeps the full GPU stack — headless GL does not need X or Wayland. Onboard WiFi works out of
the box, and raw layer-2 ethernet is plain Linux `AF_PACKET`. The 4B is a well-trodden target
for this OS, so no fallback release is anticipated.

Considered and rejected for now: DietPi (fine, marginal gain), Ubuntu Server (heavier, no
upside), Buildroot/Yocto (right answer eventually for a fixed appliance — fast boot, read-only
rootfs, reproducible builds — but too much upfront cost before the renderer is proven).

Install-time setup:

- `dtoverlay=vc4-kms-v3d` in `/boot/firmware/config.txt` → provides `/dev/dri/card0` and the
  render node `/dev/dri/renderD128`
- EGL + GBM + GLES development packages; run user in the `video` and `render` groups
- WiFi as the control/limut link, with power-save disabled so the link does not stall
- `eth0` marked unmanaged in NetworkManager with no DHCP and no IP address — the 5A-75B does
  not speak IP, it takes raw broadcast frames; the link just needs to be up
- `CAP_NET_RAW` granted to the renderer binary via `setcap`, rather than running it as root

## Pi build as flashed

Card written 2026-08-17 with `2026-06-18-raspios-trixie-arm64-lite` (SHA256 verified against
Raspberry Pi's published checksum).

### What actually happened during bring-up

Bring-up took several failed cycles. The conclusion, verified on the running system, is worth
recording because two plausible-looking diagnoses along the way were **wrong**:

**Both provisioning mechanisms are present on this image.** `cloud-init` is installed (with
`user-data` / `network-config` / `meta-data` on `bootfs`, stock and fully commented out), *and*
so is `/usr/lib/raspberrypi-sys-mods/imager_custom`, the handler for `custom.toml`. Neither is
"the wrong one".

**Neither completed, and the cause was undervoltage.** A `custom.toml` left byte-identical on
the card after a boot looks exactly like "this mechanism is ignored", but it is equally
consistent with "the boot never reached the configuration stage". It was the latter. Do not
read a surviving `custom.toml` as proof of the mechanism.

**What worked, and is the reliable fallback:** a script on `bootfs` invoked by appending to
`cmdline.txt`:

```
systemd.run=/boot/firmware/firstrun.sh systemd.run_success_action=reboot systemd.unit=kernel-command-line.target
```

systemd runs it as root with the rootfs mounted, independent of every Pi-specific provisioning
service. The script must strip those three parameters back out of `cmdline.txt` and delete
itself, or it runs on every boot. `cmdline.txt` must stay a **single line** — a stray newline
makes the machine unbootable. This is also the only route in when there is no keyboard, since
macOS cannot mount the ext4 rootfs.

**Gotcha: the image ships a placeholder `pi` account with `/usr/sbin/nologin` as its shell.**
So `if ! id -u pi` is *true* on a fresh image and skips account creation. The result is an
account that accepts the SSH key and then immediately prints "This account is currently not
available" — and because sshd runs subsystems through the login shell, SFTP is dead too, so
there is no way to repair it over the network. Always set the shell explicitly with
`usermod -s /bin/bash pi` rather than relying on `adduser` having run.

If using cloud-init instead, note that `meta-data` carries an `instance_id` which cloud-init
caches and compares each boot; it only re-runs first-boot setup when that value *changes*.

### Settings applied

| Setting | Value |
|---|---|
| Hostname | `hub75-01` (so `hub75-01.local` over mDNS) |
| User | `pi` |
| SSH | enabled, key-based; password auth also on as a bring-up fallback |
| SSH key | `~/.ssh/id_ed25519_hub75` on the dev Mac — a dedicated key, not the default identity |
| WiFi | WPA2-PSK, stored as the derived PSK rather than the plaintext passphrase |
| Country / locale | `GB`, keymap `gb`, timezone `Europe/London` |

`dtoverlay=vc4-kms-v3d` is already enabled in the stock `config.txt`, so the DRM/V3D path
needed for headless GPU rendering is available with no config change. `arm_64bit=1` and
`arm_boost=1` are also stock.

Verified working on the stand-in 3B+ (2026-08-17): WiFi associates, `hub75-01.local` resolves,
key-based SSH login works, `pi` is in `video` and `render`, and `/dev/dri/card0` plus
`/dev/dri/renderD128` are both present.

### Moving the card to the 4B

Done 2026-08-18: the card was moved from the stand-in 3B+ straight into the 4B and **booted
first time**, same hostname, same IP, same SSH host key, WiFi associated without intervention.
No reflash was needed. The checks that predicted this:

- SD host drivers (`sdhci-iproc`, `sdhci-brcmstb`, `bcm2835`) are **kernel built-ins**, not
  modules, so the initramfs is board-independent and `MODULES=dep` is a non-issue on Pi kernels.
- The NetworkManager profile has no `mac-address=` binding, so it still associates on a board
  with a different radio MAC.
- `/etc/fstab` keys off PARTUUID, not device names.
- `bcm2711-rpi-4-b.dtb`, `start4.elf`, `fixup4.dat` and `kernel8.img` are all on `bootfs`.
- The root filesystem survived the brownouts: state `clean`, zero error count.

The SSH host key carries over too, so no `known_hosts` churn after the swap.

Board as running: **Raspberry Pi 4 Model B Rev 1.5, 1GB RAM** (`free` reports 905Mi). Worth
knowing — this is the smallest 4B variant, so the renderer should not assume headroom for large
host-side texture staging.

**Power is clean on the 4B**: `vcgencmd get_throttled` returns `0x0` with zero undervoltage
events in the kernel log, on the same supply that was still browning out the 3B+ at idle. That
retrospectively points at the 3B+'s own micro-USB input rather than the supply, and closes out
the problem that cost most of first bring-up.

Remaining: turn off SSH password authentication now that key login is confirmed.

## Protocol

Specified in **`PROTOCOL.md`** (version 1), with a zero-dependency reference display in
**`mock/`** that the host side can be developed against before the panels arrive.

The decisive fact behind the design: a **visualsynth px chain compiles to a completely
self-contained shader**. `draw/visualsynth/codegen.js` emits `#version 300 es` with no common
processors, no `preprocess`/`postprocess`, and none of the ~30 standard `l_*` uniforms — against a
generated program every one of those locations resolves `null`. So the whole shippable state of a
visual is a fragment source string, N `vec4` uniforms named `u_vs0..`, and M textures. Per frame
that is `16 × N` bytes; at N=8 and 60Hz, 8.6 kB/s. **Bandwidth is not a constraint anywhere in
this system** — the design problems are all framing, caching, error reporting and lifecycle.

Shape of it:

| | |
|---|---|
| Transport | one WebSocket, one port (7575), `/info` for discovery + `/session` for the session. WebSocket because it is the only bidirectional binary transport a plain browser has; usage is constrained to a minimal subset (no extensions, no fragmentation, ≤ 60 KB messages) so the Pi's own server stays ~150 lines of C |
| Discovery | avahi advertises `_limut-hub75._tcp`; the browser resolves `<name>.local` and probes `GET /info`. Real enumeration would need a Node/Electron helper and is not in v1 |
| Host binding | new `display` param on `visualsynth`: `v1 visualsynth px=..., display='hub75-01'` sends that player to the panel instead of the main canvas |
| Layer lifetime | **one persistent layer per player**, not per event. The wall shows continuous output; animation comes from the uniform stream |
| Compositing | one player per display in v1; the frame packet reserves a layer count so multi-layer is a later extension, not a framing change |
| Setup vs. frames | JSON text frames for control, binary for the 60Hz uniform packets and asset chunks, on the same socket. Assets are chunked at 16 KB and interleaved so a 1 MB image cannot stall the uniform stream |
| Caching | programs and textures are content-addressed by SHA-256, so a reconnect costs a `have` round trip rather than a re-upload |
| Errors | typed `error` messages (`compile`/`link`/`asset`/`render`/`protocol`) carrying the driver info log. Compile failures are **permanent** for that source hash, mirroring `draw/visualsynth.js` setting `programs[src] = null` |
| Dimmer | an `f32` in every frame packet (so `dim=[0:1]l` works as a timevar), plus a `dim` message for when no frames are flowing. Applied pre-gamma in the output stage, so it works even with a broken or absent shader |
| Frame pacing | last-write-wins: a frame superseded before it was drawn is dropped, not queued. Same decoupling `draw/dmx-worker.js` already does for DMX |

### Two things worth remembering

**Textures bind to the layer, not to the program.** The program id is the hash of the shader
source, and a lut's *contents never appear in the source* — only its size does, baked in as a
literal by `lookupExpr` in `draw/visualsynth/nodes.js`. So `tex1d{{x}->x}` and `tex1d{{x}->1-x}`
generate byte-identical GLSL and share a program id while needing entirely different texture data.
Hanging textures off the program would silently render the second chain with the first one's lut.
This was found by a mock selftest written to check something else.

**The uniform list is positional on the wire.** Slot index is the index into `prog.uniforms`, so a
declared list that disagrees with the shader source is a silent wrong-picture bug rather than a
crash. The mock checks for it on every `prog`, and the real display should too.

## Host side (limut end)

Built 2026-08-18, in `host/`, against the mock. `v1 visualsynth, px=..., display='hub75-01'` now
sends that player to the panel instead of the canvas, with `dim=` for the wall's brightness.

| file | |
|---|---|
| `host/hub75.js` | the registry. `setLayer`/`releaseFor` from visualsynth, `perFrameUpdate` from main.js, the `hub75` console commands |
| `host/session.js` | one display: endpoint resolution, `/info` probe, socket lifecycle, the reconcile state machine, caches, backoff |
| `host/assets.js` | classify a visualsynth texture into a wire asset; chunk maths. Pure, no GL |
| `host/sha256.js` | content addressing, with a plain JS fallback |
| `codec.js` | shared with the mock: the one copy of the §12 byte layout |

Four things worth knowing before touching it:

**The host is a tap, not a second renderer.** `buildSource()` in `draw/visualsynth/codegen.js`
already returns everything shippable — the source, the ordered uniform ASTs, the textures — so
`draw/visualsynth.js` hands that object straight over and returns nothing. `draw/sprite.js` turns a
falsy renderer result into a task that removes itself, so no local drawing happens and no code
there needed changing.

**Layers are keyed on source *and* texture identity, not on the shader alone.** This is §7.2 made
concrete: `tex1d{{x}->x}` and `tex1d{{x}->1-x}` generate byte-identical GLSL, so they share a
program id while needing different lut data. `layerKey()` mixes in a per-texture-object id from a
WeakMap. The `edit` scenario in `mock/host-check.js` is that exact case end to end.

**A webcam texture is identified by `update()`, not by `.video`.** `draw/webcam.js` attaches
`.video` inside `update()`, which `draw/sprite.js` calls — and sprite.js never runs for a display
bound player. Classifying on `.video` reports a webcam as an image.

**The display's cache is asked about, never assumed.** Every layer change sends `have` for the full
id list rather than filtering by what the host thinks the display holds. Caches survive a session
change (§5.1) but not a power cycle, and a host that assumed otherwise binds a layer naming a
program the display never received — a session-closing protocol error it would then reconnect
straight back into, forever. The `restart` scenario in `mock/host-check.js` is that case.

**Frame packets carry the *bound* layer's uniforms, never the newest ones.** While a new chain is
still uploading the display is still showing the old program, and a uniform count that disagrees
with it is a session-closing protocol error (§12.1). `host/hub75.js` keeps a small map of live
params per layer key for exactly this window.

`crypto.subtle` is undefined outside a secure context, so opening limut over the LAN
(`http://192.168.x.x:8000`) rather than `localhost` would break content addressing with an
unrelated-looking TypeError. `host/sha256.js` falls back to plain JS instead.

### Testing the host side

`mock/host-check.js` drives the *real app in real Chrome* against the mock and asserts on what the
display observed — 56 assertions over seven scenarios: happy path, compile failure, packet loss,
reconnect, display restart, live edit, webcam refusal.

```sh
sh server.sh                                  # limut on :8000
node draw/hub75/mock/host-check.js            # all scenarios
node draw/hub75/mock/host-check.js edit       # just one
```

`mock/harness.html` is how it gets in: limut in a same-origin iframe, code seeded through
localStorage, the app's own `go()` called. There is no CDP route — Chrome 148's `Runtime.evaluate`
hangs. Each run gets a **fresh Chrome profile**: a shared one caches the app's modules (the dev
server sends no `Cache-Control`) and a scenario then quietly tests the previous edit's code.

Two traps found while writing the restart scenario, both worth knowing before adding another:
`display.stop()` closes the listener but **leaves live sockets open**, so a scenario that wants the
host to notice must close the session's connection too — and it must do so *after* stopping the
listener, or the host's 250 ms retry reconnects to the display that is about to vanish and then
sits contentedly on a socket nothing is serving. And `/connected/` matches `disconnected`, which
made an assertion pass for the wrong reason; match `: connected` instead.

## Pi renderer (the display end)

Built 2026-08-19, in `pi/`: one C binary, `limut-hub75`, that serves the protocol, renders the
shader on the V3D GPU at panel resolution, and hands the pixels to an output stage. Running on
`hub75-01` as a systemd service. See `pi/README.md`; only the things worth knowing from outside
are here.

**C, built natively on the Pi.** The protocol was shaped to keep a C display small and it did:
the RFC 6455 server is ~200 lines, and SHA-1, SHA-256, base64 and JSON are vendored rather than
linked so the build line stays as short as `tools/egl-probe.c`'s. Cross compiling was rejected —
a sysroot to keep in sync buys nothing when C compiles in seconds on the board.

**One thread, the render inline, no queues.** Drain every readable byte, dispatch it, then draw
whatever survived. Draining fully before drawing is what makes §12.1's last-write-wins free: a
frame superseded before it was drawn is never queued, only counted.

**The GLES half of `render.c` compiles out where there is no EGL/GBM**, so the whole daemon runs
and is testable on a Mac with nothing drawn. That is not a curiosity — it is how the protocol
side was built and debugged before it ever reached the board.

Two HTTP routes exist for testing and are documented as outside protocol v1: `/frame.raw` (the
last frame as it left the output stage — dimmer and gamma applied, i.e. what the panels would
show) and `/debug` (the internal state `mock/display.js` exposes as `main.display`, field for
field).

### Things found while building it

**`mock/selftest.js` gained `--endpoint`, and it is the conformance suite.** The mock was written
as a *reference display*; that pays off here, because the same 63 assertions now run against the
C daemon over the network. Making that work needed no new assertions, only a snapshot of `/debug`
refreshed on every await — which is why `/debug` exists at all. Two blocks differ: `--fail-compile`
is replaced by a shader that genuinely fails (a better test), and the frame-drop assertion is
split, for a real reason. **The mock consumes at most one frame per simulated 60 Hz tick; a real
display renders on arrival, so at a 60 Hz host rate it legitimately drops nothing.** The
invariant that holds for both, and the one that actually matters, is that every accepted packet
is drawn or counted as dropped — never silently queued.

**A websocket read buffer must be consumed *after* the message is dispatched, not before.** The
payload points into the buffer, and consuming shifts the remainder down over exactly that region.
It only corrupts anything when two messages arrive in one read — which at 60 Hz is the normal
case, and which no test that feeds one frame at a time will ever produce. It showed up as
"malformed JSON" on a message that was perfectly well formed.

**macOS Local Network permission is per browser, and denying it looks exactly like a CORS bug.**
On macOS 15 and later an app must be granted Privacy & Security → Local Network before it can
reach another device on the LAN. Firefox without it fails every request to the display —
`.local` name, IPv4 literal, IPv6 literal, `fetch` and WebSocket alike — and limut reports
`CORS request did not succeed, status code (null)`, which is nothing to do with CORS. Chrome and
Terminal had been granted it, so curl, Node and every automated check here passed throughout.

Two things identify it in seconds, and both matter because the error message points the wrong
way. **The failure takes 1-2 ms**, far less than a round trip to a LAN host, so nothing was ever
sent — a genuine connection problem takes at least a ping time. And **`mode: 'no-cors'` fails
too**, which no header problem can cause. Requests to `localhost` and to the machine's own LAN
address still succeed, because neither is another device; testing only those is what makes it
look host-specific. The permission takes effect when the browser restarts.

**A display that only serves one connection at a time is not a display a browser can talk to.**
Browsers open speculative connections they may never use; Firefox preconnects several per origin
and holds them. The first version had eight client slots, no idle timeout, and refused new
connections when the table was full — so **eight idle sockets that sent nothing made the display
completely unreachable**, permanently, until it was restarted. curl, Chrome and every automated
check here use one connection at a time and all passed against it. The symptom in the browser is
`CORS request did not succeed, status code (null)`, which points at headers and is nothing to do
with them: a null status means nothing answered. The fix is three things, and it needed all
three — more slots, reaping connections that never complete a request, and evicting the oldest
idle connection rather than refusing the new one when full.

**The display's listening socket has to be dual stack, and testing in one browser will not tell
you.** avahi publishes both an A and an AAAA record for `hub75-01.local`, so it resolves to both
and a browser may prefer either. An IPv4-only bind works perfectly in Chrome and fails in Firefox
with `CORS request did not succeed, status code (null)` — a message that reads as a header
problem when nothing is listening on the address it tried. Every automated check passed against
the broken build because they all went over IPv4. One `AF_INET6` socket with `IPV6_V6ONLY` off
serves both families, and the daemon now says which it bound in its startup line.

**Nothing that forks belongs on the 60 Hz loop.** `stat.throttled` came from
`vcgencmd get_throttled`, and that fork every ten seconds showed up as a 21 ms `renderMs` spike,
30× the normal frame. The same undervoltage signal is a plain sysfs read from the
`raspberrypi-hwmon` driver — `/sys/class/hwmon/hwmonN/in0_lcrit_alarm`, where `name` is
`rpi_volt` — latched in the daemon into vcgencmd's own bits (`0x1` now, `0x10000` has occurred).
`renderMs` max went from 21.70 to 0.67.

### Measured on the board, 2026-08-19

128x64, a shader with an 8-iteration per-pixel loop, driven at 60 Hz for 20 s
(`node draw/hub75/pi/perf.js`):

| | |
|---|---|
| `renderMs` | mean 0.64, max 0.67 — render, readback and output stage together |
| fps | 49 drawn of 59 sent; the other 10 are superseded arrivals, not overload |
| temp | 42 C, no heatsink |
| `throttled` | `0x0` |

**Readback is not the bottleneck and a PBO ring would buy nothing.** A synchronous `glReadPixels`
costs well under a millisecond at this size, so pipelining a frame behind would cost 16 ms of
latency for no gain. Revisit only if a much larger panel changes that.

## Panels

| | |
|---|---|
| Column / data driver | **ICN2037BP** — Chipone, 16-channel constant current sink, dual latch |
| Row / scan driver | **RUC7258E** — Ruichips, 8-channel line driver, internal 3-to-8 decoder, 2.8 A, SOP-16 |
| Label | `P5(2121)-3264-16S-M5` |
| Pitch / LED | 5 mm, SMD2121 (indoor) |
| Module | 64 x 32 pixels, 320 x 160 mm |
| Scan | 1/16 |
| Chip counts | 24 x ICN2037BP, 4 x RUC7258E per module — both confirmed on the board |
| Array | **6 modules, 64 x 192 (1:3 portrait)** — each 64x32 module mounted **rotated 90deg** (32w x 64h in the display); two side-by-side columns of 3 stacked modules. **J8 = left column** (x 0-31), **J1 = right column** (x 32-63) |
| Colour order | **bgr**, established on the bench |

**This is the easy case, and it is worth knowing why.** Both chips are of the plain generation:
the ICN2037BP is a shift register, latch and constant current sink with no internal PWM engine and
no configuration registers, and the RUC7258E is a multiplexer with no configuration at all. Nothing
on the panel needs an initialisation sequence, unlike the S-PWM generation (ICN2053, FM6353,
MBI5153), which does and which has to be told about explicitly. A panel like this is what a
receiving card's generic settings are for.

**How to read the chip counts, correctly.** Both counts check out against the label, but only once
the row rule is right — the obvious version of it is wrong and is worth writing down so it is not
re-derived wrongly later:

- **Row chips × 8 = the number of physical rows, i.e. the panel height — not the scan rate.** Every
  row needs its own switch whatever the scan is: at 1/16 on a 32-high panel, rows *k* and *k+16*
  are lit together, so all 32 rows are switched, not 16. 4 × RUC7258E × 8 = 32 = the panel height.
- **The scan rate comes from the column drivers instead.** Each ICN2037BP sinks 16 channels. 24 of
  them is 384 channels, and 384 / 64 columns = 6 channels per column = R1G1B1 **and** R2G2B2, so
  two halves are driven at once and the scan is height / 2 = **1/16**. Twelve chips would have
  meant one data group and 1/32.

Both counts therefore agree with `3264-16S`, and each was derived independently of the label.

Do **not** read the trouble reports around these part numbers in `hzeller/rpi-rgb-led-matrix` and
`ESP32-HUB75-MatrixPanel-DMA` as trouble here. Those libraries bit-bang HUB75 timing from a CPU
and have to reproduce the scan themselves; the 5A-75B does the scanning and PWM in its FPGA, which
is the entire reason for using one. Different problem class.

The colour order is a property of the PCB wiring rather than of either chip, so it stays an
empirical question whatever the datasheets say.

### The display as built, 2026-09-02

Six modules, wired as **two chains of three**, each **64x32 module mounted rotated 90deg** (so it is
32 wide x 64 tall in the display), forming two **side-by-side full-height columns** — **J8 drives the
left column** (x 0-31), **J1 the right column** (x 32-63). That gives a **64 x 192** portrait panel, a
1:3 aspect ratio, 960 x 480 mm of wall. The two ports are J1 and J8, not adjacent; the card drives two
of its eight groups and the mapping has to say so rather than assume J1/J2. (Corrected 2026-09-04: the
chains are left/right columns, not top/bottom halves as first recorded.)

Two consequences worth having written down before the card is configured:

**This is the number that justifies configuring the card.** 64 x 192 is 12,288 pixels, against the
655,360 the current 1280 x 512 canvas transmits to light them. At 3 bytes per pixel and 60 Hz that
is **2.2 MB/s rather than 120 MB/s** — so once the card believes in the real geometry, frame rate
stops being a bandwidth question at all. It is also far inside the 128 x 1024 normal-chip ceiling,
so nothing about this array is near the card's limits.

**Power is now a real supply, not an afterthought.** Six modules at roughly 20 W each is **~120 W,
i.e. 24 A at 5 V** at full white. `--brightness` and `dim` keep the average far below that, but the
supply and the wiring have to survive a white frame — and `--test-pattern white` produces exactly
one. Check the figure against the modules' own labels rather than trusting the 20 W estimate.

### What the 5A-75B will take

From Colorlight's own datasheet (`Datasheet_Colorlight_5A_75B_Receiving_Card_V1_0`, spec V8.3.1):

| | |
|---|---|
| Control area | **normal chips 128 x 1024**, PWM chips 192 x 1024, Shixin chips 162 x 1024 |
| Scan | up to 1/128 |
| Per module | any rows and columns within 13312 pixels |
| Data groups | up to 16 parallel (8 HUB75 ports, J1–J8, two groups each) |
| HUB75 signals | RD1 BD1 RD2 BD2 data, A B C D E scan, CLK LAT OE control |

**The ICN2037BP is a "normal chip"**, so the ceiling that applies here is **128 x 1024**, not the
192 x 1024 that the marketing copy quotes. In 64 x 32 modules that is 16 across by 4 down — 64
modules, 8 modules per port. Nowhere near binding for anything this project will build, and each
module's 2048 pixels is far inside the 13312 per-module limit.

Note the daemon's existing default of `--size 128x64` is exactly a 2 x 2 array of these modules,
which is 640 x 320 mm of panel.

**Power is the constraint that actually bites, and it is not on the card.** Budget on the order of
20 W — about 4 A at 5 V — per module at full white, and check it against the module's own label
rather than that figure: a 2 x 2 array at full brightness is then a ~16 A 5 V supply, which is a
real power supply with real wiring, entirely separate from the Pi's. `--brightness` and `dim`
between them keep the average far below this, but the supply has to survive a white frame.

## Colorlight output stage

Built 2026-08-28: `pi/output_colorlight.c` fills the seam, and `tools/colorlight-probe.c` is the
safe way to ask a card what it is. **Neither has met a card yet** — everything below is the wire
format as documented by other people, implemented and unit tested, and waiting to be corrected by
hardware.

**The offset convention is the thing to get right first.** Colorlight puts the packet type in the
*first* byte of the ethertype field and treats the *second* as the first byte of data. What a
sniffer calls "ethertype 0x5500" is really type 0x55, `d[0] = 0x00`. Both the probe and the output
stage write offsets as `d[n]` where `d = frame + 13`, the same convention the upstream reverse
engineering uses, so the two can be compared without an off-by-one. Harald Kubota's write-up
numbers from frame byte 14 instead, which is where an apparent contradiction between the two
sources usually turns out to be a shifted index rather than a disagreement.

| type | | |
|---|---|---|
| `0x07` | discover | 284 byte frame, `d[3]` = which receiver is being asked for |
| `0x08` | reply | 1070 bytes: `d[0]=0x05` marks a 5A, `d[2:3]` firmware, `d[21:24]` cabinet size, `d[38:41]` packets received, `d[46:49]` uptime |
| `0x55` | pixel data | `d[0:1]` row, `d[2:3]` first pixel, `d[4:5]` count, `d[6]=0x08`, `d[7]=0x88`, then 3 bytes per pixel |
| `0x01` | display/sync | 112 bytes, `d[0]=0x07` (a PC, not a sender card), `d[22]` and `d[25:27]` brightness, `d[23]=0x05`. Latches the rows just sent |
| `0x0A` | brightness | 77 bytes, `d[0:2]` brightness |

**497 pixels per packet** is not arbitrary: 3 bytes per pixel plus the 8 byte data header reaches
a 1500 byte MTU exactly there, so a row wider than that is split and `d[2:3]`/`d[4:5]` exist for
precisely that case.

**The packet building is deliberately portable and the sending half is not**, the same split
`render.c` makes around EGL. So `output_colorlight.c` compiles on a Mac, `test_colorlight()` in
`pi/selftest.c` covers the byte layouts there (39 of the suite's 117 checks), and only
`--output colorlight` itself needs Linux. The offsets in the test are written out longhand,
independently of the implementation, so that a change to either shows up as a failure rather than
as two files agreeing about the wrong thing.

**`--test-pattern bars|grid` brings the panels up with no host, no shader and no socket.** It sets
the starting pattern that the protocol's `pattern` message could otherwise only reach over a
WebSocket — which is the wrong dependency to have during a first power-on. The pattern still goes
through the dimmer and gamma like anything else (§9).

Per frame the 60 Hz path is a memcpy per row into pre-built packets and one `sendmmsg`: headers,
iovecs and `mmsghdr`s are all filled once at open, since only the pixel bytes change.

### Verified against the real card, 2026-08-29

First contact with the actual 5A-75B, over `eth0` on `hub75-01`, no panels attached. The card is
**firmware 10.16, receiver 0**, and answers a discover in **59 microseconds**.

What the hardware settled:

- **The discover/reply exchange works exactly as implemented.** Frame sizes 284 out and 1070 back,
  MACs and type bytes as documented.
- **Our pixel, sync and brightness packets are byte-correct on the wire.** Captured and read back
  frame by frame: a row packet reads `3f 00 00 00 80 08 88 ff ff ff …` — row 63, pixel offset 0,
  count 128, the two constants, then pixels — and the sync packet carries `28 05 00 28 28 28`, i.e.
  brightness 40 at `d[22]`, the constant `0x05` at `d[23]`, and the three per-channel values.
- **The card accepts our pixel traffic.** `d[41]`, the low byte of FPP's packet counter, moved from
  0 the moment frames were sent. It does not advance one-per-frame, so what it counts is still
  open — but it responds to our traffic, which is the part that mattered.
- **`d[46:49]` is the uptime, confirmed exactly**: across a run that took about 5 s of wall clock,
  it advanced from 470368 to 476179 ms, a difference of 5811.
- **The receiver-number disagreement is resolved in FPP's favour.** `d[85]` reads 0, matching the
  receiver we asked for; Harald's `d[63]` reads a constant `0xba` and is not a receiver number.

Found by dumping the whole reply before and after sending frames and diffing it — worth repeating
for any other field, because it distinguishes a counter from a constant with no guessing.

**The geometry field is right, and doubting it cost time.** `d[21:24]` reads `05 00 02 00`, which
FPP's decode turns into **1280 x 512** — and that is exactly the canvas the card wants. It was
dismissed here as "almost certainly wrong" because it is five times the 128 x 1024 the datasheet
gives for normal chips; that reasoning was wrong. The datasheet figure is what the card can
usefully *drive*, not what it will *accept* as a canvas. Sending 1280 x 512 is what first lit the
panel. Believe this field.

### The card as found, and how to drive it

Established on the bench 2026-08-29, one P5 64x32 module on J1:

| | |
|---|---|
| Canvas | **1280 x 512** as reported, i.e. 1280 x 256 in panel space |
| Scan configured | **1/32**, against panels that are **1/16** — the central problem |
| Colour order | **bgr** — we send red, the panel lights blue |
| Panel position | cell **17** of the `map` grid: panel space x=1088, y=0 |

Which makes the working command:

```sh
limut-hub75 --output colorlight --iface eth0 \
    --size 64x32 --canvas 1280x256 --offset 1088,0 \
    --row-map 2 --panel-rows 32 --color-order bgr
```

**The scan mismatch, and why it is fixable in software.** The card drives 32 scan addresses on
A-E; a 1/16 panel decodes only A-D, so addresses *k* and *k+16* select the same physical row and
two canvas rows are **superimposed** on it — not swapped, added. Worked out from the `bands` test
(below), physical row *p* receives canvas rows *p* and *p+16* for p<16, and *p+16* and *p+32*
above. So each panel eats 64 canvas rows to show 32 physical ones, and the fix is to put content
in one row of each colliding pair and transmit the other black. That is `--row-map 2`, and the
group size is the **physical panel height**, not the height being rendered — getting that wrong
produces a fix that changes nothing, because the blacked-out rows land outside the panel.

**Brightness must lead every frame.** FPP's notes call the duplicate brightness packet "possibly
unnecessary", which read as licence to send it once at open. The card disagrees: sent once, the
panel showed a single flash as the daemon started and then stayed dark for good. LEDVISION and FPP
both put it at the head of every frame, and so must we.

**Row packets must go out in canvas order, and the whole canvas must go every frame.** This is the
single most expensive thing learned here, because the obvious optimisations all fail and they fail
*gradually*, which makes them look like hardware faults:

- Sending only the packets whose pixels changed, and letting the card hold the rest: **black panel**.
- Sending those plus a rolling slice of the unchanged remainder, so everything is refreshed once a
  second: **horizontal glitching a few times a second**.
- Sending everything, but with the live packets reordered to the front: **still broken**.
- Sending everything, in strict canvas row order: **correct**.

The card is not a frame buffer that can be patched. It wants a whole frame, in order, per sync.
The reordering was the actual fault in all three broken cases — the middle one merely reordered
less. Note the failure is not a crash or an error; the link stays clean, `tx_errors` and
`tx_dropped` stay at zero, and the card keeps acknowledging packets throughout.

**The transmit queue has to be deepened, or a full canvas silently loses about a third of itself.**
One frame is 1538 packets in a single `sendmmsg`, and the default `txqueuelen` on `eth0` is 1000.
The overflow shows up only as `/sys/class/net/eth0/statistics/tx_dropped` climbing — nothing fails,
no error is returned, and at 60 Hz it can even look fine, because a row missed by one frame is
resent by the next. `ip link set dev eth0 txqueuelen 8000` fixes it; the systemd unit now does this
before starting.

Measured at 1280x512, 60 Hz, one panel, with the queue deepened:

| | |
|---|---|
| rate | 92,443 packets/s, **120 MB/s** |
| drops | 0 |
| frame gap | median 16.67 ms, p99 17.11, max 17.13 |

**120 MB/s is essentially the whole gigabit link**, for 2048 visible pixels, because the canvas is
twenty times wider than the panel. It works and it is stable, but there is no headroom: a second
panel is free (it is already inside the same canvas), while raising the frame rate or the canvas
size is not. The way out is a smaller canvas, which means configuring the card — the first thing in
this whole project that would actually be improved by LEDVISION, and it is an optimisation rather
than a necessity.

### The patterns, and why each exists

`patterns.c` grew during this bring-up, and the additions are not decoration — each answers a
question the previous one could not:

| | |
|---|---|
| `bars`, `grid` | the originals: colour channels, and panel seams |
| `white`/`red`/`green`/`blue` | flat fields. A patterned test says nothing when only part of a wall lights; a flat field is the same everywhere, so what comes back is about the panel rather than about where in the canvas the panel sits. `white` is what first proved the card drives the panel at all |
| `map` | numbers every 64x32 cell of the canvas. A lit panel then states its own position — one look instead of a nine-step bisection |
| `bands` | **the one that cracked it.** 16-row bands of red/green/blue/black, repeating every 64 rows. Under superposition the colours *add*, so the result names the offset: red-then-green means rows land 1:1, yellow-then-blue means rows 16 apart collide, magenta-then-green means 32 apart |
| `rowid` | each row spells its index in binary. Sound in principle, useless in practice: a 9-bit code per row cannot be read off a photograph of a 32-row panel at an angle. **Encode a diagnostic's answer as colour, not as data**, whenever a human eye is the sensor |

### What actually went wrong, in order

Worth keeping, because three of the five wrong turns cost more than the real faults did:

1. `pkill -f limut-hub75` and `pkill -f "output colorlight"` **match the shell running them**, since the pattern appears in that shell's own command line. This silently killed a backgrounded daemon and an entire diagnostic sweep. Use `pkill -x`.
2. Counting `tcpdump` output lines is not a packet rate; it gave a figure 11x too high. `/sys/class/net/*/statistics/tx_packets` is exact and free.
3. `make` builds the daemon, not `selftest` — a stale test binary reported the old check count after new checks were added. `make selftest`.
4. The sync packet looks absent in a capture filtered on the string `ethertype`, because type `0x0107` is 263, below 1500, so tcpdump reads it as an 802.3 length. Every other Colorlight type is above 1500 and shows normally.
5. A card that has just been powered does not answer discovery for the first minute or so, on a link that is already up at 1000 Mb/s.

### Two traps worth knowing

**tcpdump hides the sync packet.** Its type is `0x0107` = 263, which is below 1500, so tcpdump
reads the field as an 802.3 *length* rather than an ethertype and prints the frame as
`802.3, length N: LLC, dsap Null …`. Filtering a capture on the string `ethertype` therefore drops
every sync packet and makes a working output stage look like it never latches. The pixel (`0x5500`),
discover (`0x0700`), reply (`0x0805`) and brightness (`0x0aXX`) types are all above 1500 and show
normally, which makes the gap look meaningful when it is not.

**A card that has just been powered does not answer.** The first probe after power-on returned
nothing on a link that was already up at 1000 Mb/s; a minute later the same command worked every
time. Give it a moment before concluding anything is wrong.

**A test pattern free-runs.** `display_draw` only runs when a frame arrived or something changed,
so with no host a pattern would be drawn once and then never again — and a receiving card that
stops being fed blanks. `--pattern-fps` (default 60) re-sends on the daemon's own clock;
`--pattern-fps 0` restores the draw-once behaviour.

### Configuring the card, given no Windows machine

**Done 2026-09-04 — the card is reconfigured. Full write-up in `LEDVISION-CONFIG.md`** (the procedure,
the Mac-VM environment, the wrong turns, and the config protocol's wire format decoded from a capture,
`ledvision-config-20260904.pcap`). Headlines: LEDVISION **8.5** (not 9.x / LEDSetting, which demand a
sender) in **Net Card** mode with **real WinPcap** (not Npcap), driven from an emulated x86 Windows 10
in UTM over the USB-C gigabit dongle. The card is now a **192×64 native landscape, 1/16-scan** cabinet,
four data groups on **J1+J2**; the panels' 90° mounting rotation is left to limut (a free shader
transform) rather than the card. The old text below is kept for the reasoning that led here.

The card needs a *receiving-card configuration* — panel scan, driver chip, chaining — before it
will show a sane picture, and the only supported way to write one is LEDVISION, which is
Windows-only. Three facts shape what to do about it:

- **The configuration lives in the card's flash and is written once.** After that the card runs
  standalone and every sender, ours included, only ever sends frames. So LEDVISION is needed at
  most one afternoon, ever, for this card and this panel layout.
- **The card may already be usable.** Cards ship configured for something. `colorlight-probe`
  reads back the geometry the card believes in, at zero risk, and `--test-pattern bars` then says
  whether that belief matches the panels. Do both before assuming Windows is needed.
- **Sending a configuration cannot brick the card; a firmware upgrade can.** A wrong configuration
  is a garbage picture and a resend. The only brick path in LEDVISION is its receiving-card
  *firmware upgrade*, which this project has no reason to touch — the stock firmware is exactly
  what `pi/` targets. The real risk of a wrong scan configuration is to the *panels*, which can be
  driven hotter than intended, so configure at low brightness and do not leave a garbled pattern
  running.

If a configuration does turn out to be needed, LEDVISION under emulated x86 Windows in UTM with a
USB-ethernet dongle passed through is the least-hardware route (Windows-on-ARM would emulate the
app but cannot load an x86 kernel driver, if LEDVISION installs one). The raw-frame path can be
proved before the card is involved: cable the VM to the Pi's `eth0`, run `tcpdump -e -i eth0 not
ip`, and click LEDVISION's receiver search — a type `0x07` broadcast arriving means the whole VM
path works.

**Capture that session.** FPP's notes name the packet types LEDVISION uses when writing a
configuration — `0x10`, `0x11` (save config), `0x18`, `0x1F`, `0x26`, `0x31`, `0x32`, `0x76` — and
nothing documents their contents. A pcap of one working LEDVISION run is therefore the
prerequisite for ever configuring a card from the Pi, not an alternative to it.

The escape hatch, if the card cannot be configured at all, is to replace the gateware
(`dgym/receiver75`, `q3k/chubby75`): our own bitstream and protocol, panel mapping in our source.
It costs an FT232H, soldering to the unpopulated JTAG pads, and a rewrite of this output stage.
Less risky than it sounds — the ECP5's JTAG is in silicon rather than in the SPI flash, so dump
the original flash first and load experiments into SRAM, where a power cycle restores the stock
card.

## Status

Render node is up and validated. The Pi 4B boots headless, joins WiFi, is reachable as
`hub75-01.local` over SSH with key auth, and has been **proven to compile and run limut-grade
GLSL ES 3.00 offscreen with pixel readback** (see `tools/egl-probe.c`). The riskiest technical
assumption in the project is now settled in our favour.

The **wire protocol is specified** (`PROTOCOL.md`) and has a **working reference display**
(`mock/`, 63 passing protocol assertions). Verified 2026-08-18: the hand-rolled RFC 6455 server
completes a handshake with real headless Chrome and round-trips JSON, binary frame packets and
replies; a 180-frame 60Hz drive against a display configured to lose 20% of packets rendered 138,
dropped 42, and stayed up and accounted for.

The **limut host side is built and verified end to end** against the mock (`host/`, 46 assertions in
`mock/host-check.js` plus inline `?test` blocks). A real browser running the real app uploads the
lut, compiles the program, binds the layer and holds a 60Hz uniform stream, and recovers from a
dropped socket with a `have` round trip rather than a re-upload.

The **Pi renderer is built and running** (`pi/`, and the section above). `hub75-01` serves the
protocol as a systemd service, advertises `_limut-hub75._tcp` over avahi, and renders limut's
shaders on the V3D GPU. Verified 2026-08-19, in four layers:

- 78 unit checks in `pi/selftest.c`, passing on both the Mac and the Pi
- the mock's own 63 assertions still pass, and the same suite passes against the C daemon over
  the network (`mock/selftest.js --endpoint hub75-01.local:7575`)
- **pixel parity with the browser**: `pi/pixel-check.js` renders the same shader in headless
  Chrome's WebGL2 and on the Pi and compares. Plain, `tex1d` and `tex3d` chains all match with a
  worst channel difference of 1, at 128x64 and again at 256x48 to cover both sides of the aspect
  softening branch
- the real limut app in a real browser, `display='hub75-01.local:7575'`, uploads the lut,
  compiles the program, binds the layer and holds a 60 Hz uniform stream with `dim` live as a
  timevar (`pi/app-check.js`, 10 assertions on what the display observed — the only check that
  puts the real host and the real display together; everything else covers one link)

The **Colorlight output stage drives a real panel** (`pi/output_colorlight.c`, and the sections
above). Verified 2026-08-29 on a P5 64x32 module: correct colour, correct geometry, a legible test
pattern, 33 packets per frame at 60 Hz with zero transmit errors, and 120 passing unit checks
covering the byte layouts. **Panel mapping turned out not to be the card's job after all** — the
card is configured for 1/32 scan against 1/16 panels, and `--row-map 2` inverts that in the output
stage, exactly the fallback `output.h` reserved. Configuring the card with LEDVISION has therefore
not been needed at any point.

**A limut visual reached the panel on 2026-08-29** — the whole chain, browser to LEDs: a
visualsynth `px` chain compiled in the browser, shipped over the WebSocket, rendered on the Pi's
V3D at 64x32 and clocked out of the Colorlight onto the wall. `display='hub75-01'`, layer bound,
46 fps sustained.

**Three things will each silently swallow a bound visual**, and all three were in play at once the
first time it was tried, so it is worth checking them in this order when a panel stays dark while
limut says it is connected:

- `--output raw` — renders the frame and discards it. This is the installed default until someone
  changes `/etc/default/limut-hub75`, so a freshly installed service *looks* healthy and drives
  nothing.
- `--no-gpu` — no renderer, so a bound layer draws nothing. Easy to leave behind after bring-up,
  because test patterns do not need a GPU and so nothing complains.
- `--test-pattern` — a pattern **replaces the layer entirely** (§10). A display left with one set
  will ignore every visual sent to it. `--test-pattern` is deliberately absent from the installed
  arguments for this reason.

Still open: driving more than one panel, and the frame rate. 46 fps rather than 60 is the canvas,
not the panel — 655,360 canvas pixels are transmitted to light 2,048 visible ones, which is most
of a gigabit link. More panels are free; a higher frame rate is not, and the way to it is a
smaller canvas, i.e. configuring the card.

## Alternative render nodes

`esp32/README.md` is a **feasibility analysis only, nothing built**: could an ESP32-S3 be a
lightweight render node driving addressable LEDs instead of panels? Short answer — the S3 has no GPU
and no path to one, but our generated GLSL is a machine-generated subset (all `vec4`, ~28 builtins,
straight-line SSA) small enough to compile on-device into a bytecode VM run once per LED. The
protocol needs no change at all, since the host is geometry-blind and `display` is a free-form
string, and 60-70% of `pi/` ports straight across. Expect **500-1000 LEDs at 60 fps** for a typical
chain. Read it before starting any such work; it ends with the two measurements that should be taken
before committing.

## Open questions

- **Does the Colorlight implementation actually work?** The frame, sync and brightness packets are
  written and unit tested from other people's documentation of the format; none of it has been
  near a card. First power-on is the test.
- ~~**Configuring the card**~~ — **done 2026-09-04.** The card is reconfigured off its factory
  1280×512/1/32 setup to a 192×64/1-16 cabinet via LEDVISION 8.5 in a Mac-hosted Windows VM, and the
  config-write protocol is captured and partly decoded. See `LEDVISION-CONFIG.md`. Remaining: reproduce
  a config *from the Pi* (diff two captures to find the scan/geometry bytes) — a later nicety, not a
  blocker. The immediate follow-on is the limut landscape→portrait rotation (below / in that doc).
- Whether the 5A-75B's own flashed configuration can express the panel layout, which is the
  assumption `pi/` is built on — the Pi sends a rectangular image and does no mapping. If it
  cannot, mapping becomes a pixel permutation in `pi/output.c`.
- Whether render + readback + **Colorlight output** still holds 60 Hz. The first two do
  comfortably (0.64 ms at 128x64); the third is written but unmeasured. At 128x64 it is 64
  packets and one `sendmmsg` per frame, so the expectation is that it disappears into the noise —
  but that is an expectation, not a measurement. Re-run `pi/perf.js` once panels exist.
- Frame pacing: the display renders on packet arrival, self-pacing to the host's rAF. That needs
  revisiting once the output stage has its own cadence.
- The gamma curve for the panels. The mechanism is in place — a 256-entry table in the output
  stage, applied after the dimmer, `--gamma` on the command line, default 2.2 — but the right
  value is a thing to find by eye once panels exist.
- Time sync: how the Pi's frame cadence relates to limut's metronome/beat clock. The frame packet
  carries `beat` and `hostTime` so this can be worked out later without a framing change.
- Live texture sources: `webcam{}` is local-only and unsupported in protocol v1. Streaming it (or
  the scope/FFT textures) would need a per-frame texture path that does not exist yet. The host
  refuses to bind a chain containing one.
- Image textures (`tex{'url'}`) are specified but not implemented host side: `draw/texture.js` keeps
  only the GL handle, so the encoded file bytes would have to be fetched separately. The host
  refuses to bind a chain containing one, and `assets.classify` has the seam for it.
- Physical display size and panel arrangement.
- USB: the intended path is USB-C gadget mode (`dwc2` + `g_ether`/NCM), which makes the link an
  ordinary network interface and needs no protocol change. Pi-side configuration is not done.

## Answered since

- *Transport from limut to the Pi, given the browser sandbox* — a plain WebSocket works from an
  unmodified browser page, verified against headless Chrome. No relay process, no WebRTC, no
  Electron requirement. The one constraint: serving limut over `https` would make `ws://`
  unreachable.
- *Language and runtime for the Pi renderer* — **C, built natively on the board.** See the Pi
  renderer section.
- *Headless rendering path, and the readback strategy* — EGL on the GBM render node with
  `EGL_NO_SURFACE`, exactly as `tools/egl-probe.c` proved, and a plain synchronous
  `glReadPixels`. **A PBO ring is not needed**: the whole render-plus-readback is 0.64 ms at
  128x64, so pipelining would cost 16 ms of latency for nothing.
- *Whether limut's shaders really run unmodified on Mesa `v3d`* — **yes, pixel for pixel.**
  `pi/pixel-check.js` renders the same source in a browser's WebGL2 and on the Pi and compares;
  plain, `tex1d` and `tex3d` chains match with a worst channel difference of 1 (which is texel
  centre rounding, not a dialect gap). No compatibility pass is needed.
