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

Not started: any Pi renderer code, the Colorlight output stage, and the panel mapping. No language
chosen for the Pi side yet, though the protocol was shaped to keep a C implementation small.

## Open questions

- Language and runtime for the Pi renderer.
- Headless rendering path details: EGL on a GBM render node vs. surfaceless, and the readback
  strategy — PBO-based asynchronous `glReadPixels` (pipelined a frame behind) is the expected
  approach, but it needs measuring.
- Whether limut's shaders really do run unmodified on Mesa `v3d`, or whether there are gaps
  between WebGL2's GLSL ES 3.00 dialect and native GLES 3.1 that need a compatibility pass.
- Whether the Pi can sustain render + readback + Colorlight output at 60Hz for the target
  panel resolution, and what degrades first if it cannot.
- Frame pacing: the protocol has the display render on packet arrival, self-pacing to the host's
  rAF. That needs revisiting once the Colorlight output stage exists and has its own cadence.
- Gamma and colour: the dimmer is specified as a linear multiply applied pre-gamma, but the gamma
  curve itself belongs to the output stage and is not designed yet.
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
