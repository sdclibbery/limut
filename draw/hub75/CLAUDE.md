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
- WiFi as the control/limut link, with power-save disabled by the `wifi.powersave = 2` drop-in
  `install.sh` writes to `/etc/NetworkManager/conf.d/`. **This line used to claim power save was
  disabled when nothing had ever disabled it** — NetworkManager leaves `802-11-wireless.powersave`
  at `default`, which is the driver's default of *on*. Turning it off is right, but measured on
  this wall it is not what was making the display jerky; see "Why the wall is jerky" below
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
`draw/visualsynth.js` hands that object straight over and returns nothing.

**A display bound event must stay out of the local render list entirely** — and "it draws nothing"
is not the same thing, which is what this said until 2026-09-06 and it was a visible bug. The
original claim was that `draw/sprite.js` turns a falsy renderer result into a task that removes
itself, so no code there needed changing. True about *drawing*: that task really does draw nothing.
But `create()` added it to the render list all the same, `draw/render-list.js`'s `isEmpty()` counts
**queued** tasks, and a task sits queued until its start time — beats fire `0.1*beatDuration` early,
so ~3 frames at 120bpm. A non-empty render list makes `draw/system.js` clear the canvas to opaque
black and `main.js` unhide it — full viewport, `background:#000f`, `alpha:false`. So **every event
of a display bound player blacked the whole limut window for a few frames** while the wall itself
was perfectly fine. `sprite.js` now returns a named `noRender` sentinel and `create()` returns
before adding it. The lesson generalises past hub75: an empty render task is not free, because the
render list's emptiness is what decides whether the canvas is on screen at all.

**A player id is not a player, and the wall paid for the difference.** Fixed 2026-09-08. The symptom
was "comment out a visualsynth and the wall carries on animating, only Ctrl-. stops it, and only in
Firefox". All three clauses pointed away from the cause. The real test case was:

```
v scopefft
v2 scope, blend='additive', fore=#00f
// v visualsynth, px=rot2{-1/7}>>sdcirclewave{[]n,[]n}..., display='hub75-01'
```

**`v scopefft` is a different line and it is never commented out**, so `players.getById('v')` kept
answering perfectly well - with a scope. `perFrameUpdate`'s orphan check asked only whether
*something* answered to that id, so it never fired, the layer was never released, and the wall kept a
picture whose chain no longer existed anywhere in the code. Animating, too, which is what made it look
like a live player: `evalUniforms` re-evaluates the stored uniform ASTs against the dead event's
`params` every frame, so a `time` based chain keeps moving with no events at all. `ownsDisplay()` now
requires the id to name a **visualsynth**, which is the only type that can ever own a layer (setLayer
is called from `draw/visualsynth.js` and nowhere else). A visualsynth that has merely dropped its
`display=` is deliberately still left to `releaseFor()` on its next event, so an ordinary re-edit of a
live display line does not blank the wall for a beat on every Ctrl+Enter.

**The same fault stranded the wall with nothing commented out at all** - editing that line's type from
`visualsynth` to `scopefft` in place did it too. And **Firefox had nothing to do with any of it**:
Electron loads `file://`, the browser build `http://localhost:8000`, so they have different
`localStorage` and were simply running different code. The `idreuse` scenario in `mock/host-check.js`
is this exact case and fails 2 of its 4 assertions against the old check **in both engines**.

**Reading the state beats reasoning about it, and it took three wrong diagnoses to remember that.**
The two that failed were "the player is not being swept" (it is - the *id* is reused) and the delivery
bug below (real, but not this). What settled it in one look was `hub75 status` plus
`Object.keys(require('player/players').instances)` from the page's own console: `player v` alongside
`v` present in the registry says "the poll is answering yes" and nothing else does.

**A layer is ended by being told, and `s.bound` must never be what decides whether we tell it.**
Fixed 2026-09-08 alongside the above, and **not the cause of it** - a separate hole found while
chasing it. `clearDesired()` sent `unlayer` only `if (s.bound)`, and **`s.bound` is host belief, not
display truth**: `onclose` clears it in case the display restarted, while a display whose *link*
dropped is still showing the layer, and `sendJson` drops a message silently with no socket. Nothing
retried either - `release()` deletes `layers[name]` so the poll is finished, and `reconcile()` returns
early on a null `desired`. So a release that happened while the link was down could never be
delivered, ever. A `wantBlank` flag now records the intent and `flushBlank` retries it from `welcome`
and from `pump()` until it has actually gone out; `setDesired` clears it, so an edit that rebinds
while a blank is owed cannot be blanked by it afterwards. The `blankafterdrop` scenario covers it and
fails 3 of 7 against the old code.

**A display bound visualsynth also has a real destructor now** (`player-types.js` ->
`draw/visualsynth.js` `releasePlayer`, via a new `playerFactory.destroy` hook in `player/player.js`),
so a removed player gives the wall up in the same synchronous sweep that deletes it and the poll is
the backstop it was always meant to be. It honours the hook's `replaced` argument: an edit is not a
removal, and releasing on one would flap the wall.

**Layers are keyed on source *and* texture identity, not on the shader alone.** This is §7.2 made
concrete: `tex1d{{x}->x}` and `tex1d{{x}->1-x}` generate byte-identical GLSL, so they share a
program id while needing different lut data. `layerKey()` mixes in a per-texture-object id from a
WeakMap. The `edit` scenario in `mock/host-check.js` is that exact case end to end.

**A webcam texture is identified by `update()`, not by `.video`.** `draw/webcam.js` attaches
`.video` inside `update()`, which `draw/sprite.js` calls — and sprite.js never runs for a display
bound player. Classifying on `.video` reports a webcam as an image.

**A refused layer used to become a disconnect** (fixed 2026-09-06). Protocol v1 has no layer
acknowledgement, so `host/session.js` binds optimistically the moment it sends `layer` — while the
display, which refuses to bind a program that failed to compile (`pi/session.c:371`, and identically
`mock/display.js`), has not. The next frame packet then named a layer the display did not have,
which §12.1 makes a session-closing protocol error. So a shader the display merely *rejected* closed
the socket **on top of the compile log that explained it**, and the only visible symptom was an
unexplained connect/disconnect loop. `onError_` now drops the bind when a compile or link error
names the bound program; frames go out with no layer, which is legal, and the log stays readable.
Two assertions in the `compile` scenario of `mock/host-check.js` cover it — they fail against the
old code with `sessions=2`.

**`ws.onclose` now reports the close code**, because it is the whole diagnosis and it was being
thrown away. 1006 means no close frame ever arrived — the daemon died or the link dropped — while
1002 is a protocol error the display chose to send and 1009 is a message it judged too big. All
three used to print the same bare `🟠 disconnected`. `session.js` also reports each program's
encoded size and uniform count (rate limited to one line a second), so "is this px chain too big to
ship?" is answerable by looking rather than by guessing; `hub75 status` carries the same numbers.
For scale: the four-octave `fbm3` fire chain measures 10,081 wire bytes, 17% of the 60 KB cap, with
83 uniforms of the 512 allowed — **size is not the constraint anywhere near current chains.**

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

`mock/host-check.js` drives the *real app in a real browser* against the mock and asserts on what the
display observed — eleven scenarios: happy path, compile failure, packet loss, reconnect, display
restart, live edit, slow compile, comment out, blank after drop, id reuse, webcam refusal. **It runs Chrome by
default and Firefox with `--firefox`** — worth having, though note the id-reuse bug above was never
actually engine specific and this file's blind spot was the *code shape* it drove, not the browser.

**Known failure, pre-dating 2026-09-05 and still not chased (confirmed unchanged 2026-09-06):** the happy path's
`its uniform list matches the source` fails — the host ships a program declaring **zero** uniforms
where `u_vs0` is expected, so `mul{sin{}}` is reaching the display as a constant rather than an
animated uniform. Isolated as pre-existing: `draw/visualsynth*` and `draw/hub75/host/` were last
touched 2026-08-31 and 2026-09-04, and the failure is byte-identical with the 09-05 mock change
reverted. Either the host stopped shipping a uniform it used to (which would render animated px
params static on the wall) or the test's expectation went stale after the 08-31 "px eval fix".
Worth resolving before trusting this suite as green.

```sh
sh server.sh                                     # limut on :8000
node draw/hub75/mock/host-check.js               # all scenarios, Chrome
node draw/hub75/mock/host-check.js edit          # just one
node draw/hub75/mock/host-check.js comment --firefox   # ...in Firefox
```

**A leftover browser silently evicts the next scenario's session**, which then fails with "another
client took the display" for reasons nothing in it explains — it cost a misread result while the
id-reuse fix was being written (`hello: 10` in one 24 s run). `p.kill()` is not enough for **either**
engine: Firefox re-execs itself and Chrome leaves helper processes, and both keep retrying the display
with `takeover: true` in their `hello`. Both runners now kill the process group and then anything
holding the run's unique profile path, matching on the profile rather than on the browser name so the
developer's own browser is untouched. If a scenario ever reports a takeover, run
`pgrep -f limut-hub75-check` before believing anything else it says.

Two things a Firefox run needs that Chrome takes as flags, both written into the generated profile:
the autoplay prefs (or the audio clock never starts and no beat ever fires) and
`media.navigator.streams.fake` (or the webcam scenario tests the "not ready yet" path instead of the
refusal, and fails three assertions for a reason unrelated to the host).

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
as a *reference display*; that pays off here, because the same assertions (63, or 66 since
2026-09-05) now run against the
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

## Why the wall is jerky: it is the WiFi, and it is not any of our code

Investigated 2026-09-04, prompted by a visual that is smooth on the canvas and jerky on the wall:

```
v visualsynth, px=add{v:[-1,1]l2@f}>>smoothstep{0,0.1}, display='hub75-01.local:7575', dim=0.5
```

**The answer: the WiFi link delivers a 60 Hz stream in bursts — roughly two stalls of 100-200 ms
every second — and §12.1's last-write-wins then collapses each catch-up burst to a single drawn
frame.** Freeze, jump, freeze. Nothing in limut, in the protocol, in the daemon or in the output
stage contributes. Three separate measurements say so, and the third is conclusive on its own.

**1. The host's send cadence is perfect.** `pacing.host` is built from the `hostTime` deltas in
the frame packets themselves, so it measures limut's own clock with the network taken out of the
picture. Over 18 s: **1015 frames, 1015 of them on time, zero early, zero late.** `seqGaps` is 0,
so the host's `bufferedAmount` backpressure rule never fired either.

**2. Arrival at the Pi is not.** Same run, same packets, timestamped as they were dispatched:

| | early | on time | 1 late | 2-4 late | **stalled (≥83 ms)** | max |
|---|---|---|---|---|---|---|
| `host` | 0 | 1015 | 0 | 0 | **0** | 21 ms |
| `arrive` | 235 | 728 | 9 | 6 | **37** | **181 ms** |

The two have the *same mean* — 17.7 ms, i.e. 60 Hz — and completely different distributions. That
is the definition of jitter, and the 235 "early" arrivals are the bunched ones that become dropped
frames.

**3. The control that settles it.** A plain paced TCP stream, 16 bytes every 16.67 ms, from the
Mac to a 20-line Python receiver on the Pi — no limut, no daemon, no GPU, no ethernet output:

| | early | on time | 1 late | 2-4 late | stalled | max |
|---|---|---|---|---|---|---|
| Mac → Pi over WiFi | 360 | 775 | 18 | 7 | **40** | 197 ms |
| Pi → Mac over WiFi | 392 | 699 | 65 | 5 | **39** | 115 ms |
| **Pi → Pi over loopback** | 0 | **1200** | 0 | 0 | **0** | 17.2 ms |

Same script, same board, same rate. Perfect over loopback, broken over the air, and **broken
equally in both directions** — so it is not one station's receive path. The link itself is
otherwise excellent: -47 dBm, 5 GHz, 433 Mbit/s, 10 tx failures in 16,285 packets, zero loss. It
is airtime, not signal. (The subnet is `192.168.68.0/24`, which is eero's default, and a mesh
backhaul sharing the radio is the obvious suspect — but that was not chased, because the fix does
not depend on which.)

**What was ruled out, and the wrong turn worth recording.** The first hypothesis here was WiFi
power save, and it looked extremely strong: it *was* on, `CLAUDE.md` wrongly claimed it was off,
and the ~100 ms stall cluster matched the DTIM period (beacon 100 ms x DTIM 1) exactly. Turning it
off changed almost nothing — 49.4 fps against 49.2, 165 drops against 174. **A mechanism that
explains the symptom, and is genuinely misconfigured, can still not be the cause.** It is off now
because it should be, not because it fixed anything.

Also ruled out: the daemon's loop (loopback is perfect), the render and output stage
(`pacing.render` mean 5.35 ms of a 16.7 ms budget), and the host (see 1).

### The fix is a wired link

There is no code fix. The host sends perfectly and the display draws everything that reaches it;
the frames are late on the air. Options, in order of preference:

- **Wire the limut link.** `eth0` belongs to the Colorlight card and has no IP, so this means
  either a USB ethernet dongle or the USB-C gadget-mode path already in the open questions
  (`dwc2` + `g_ether`/NCM), which makes the link an ordinary network interface and needs no
  protocol change at all. Loopback's 1200/1200 is what a wired link should look like.
- **Move the Pi onto a less contended AP or band**, if the mesh suspicion is right.
- **A jitter buffer on the Pi** — draw on the Pi's own clock and select by `hostTime`, which every
  frame already carries. This is the only software answer, and it was **considered and declined**
  (2026-09-04): it costs a fixed ~33 ms of latency and puts pacing logic on the hot path. Revisit
  only if the link cannot be wired.

### Done, 2026-09-05: the link is USB, and the jerkiness is gone

`eth0` could not be the wired link, so the USB-C port became one, exactly as PROTOCOL.md §3.2
specified. **Nothing in limut or the daemon changed** — not one line of `host/`, `visualsynth.js`,
`main.js` or the C. `net.c` already binds `in6addr_any` dual stack, `resolveEndpoint()` already
turns a bare name into `<name>.local`, and avahi now publishes on `usb0` only, so
`display='hub75-01'` simply *means* the USB link. Setup is `pi/usb-gadget.sh` and `pi/install.sh`.

The link, measured with `ping` before any limut was involved — 200 packets each way:

| | min | avg | max | **stddev** |
|---|---|---|---|---|
| USB (`usb0`) | 0.473 | 0.925 | **1.247 ms** | **0.165 ms** |
| WiFi (`wlan0`) | 10.072 | 25.047 | **106.265 ms** | 25.116 ms |

That 106 ms maximum is the stall described above, reproduced live. **85x better worst case,
152x less jitter.**

And the thing that actually mattered, `perf.js` over 19 s against the WiFi baseline in the table
above:

| `arrive` | early | on time | 1 late | 2-4 late | **stalled** | max |
|---|---|---|---|---|---|---|
| over WiFi | 235 | 728 | 9 | 6 | **37** | **181 ms** |
| over USB | **0** | **1052** | **0** | **0** | **0** | **18.9 ms** |

Perfect, and the same shape as the loopback control — which is what "a wired link should look
like" meant. `dropped` is 0 over the window and `throttled` stays `0x0`.

**The jitter buffer has been removed**, 2026-09-05, on the evidence below and because it never
removed the jerkiness fully — it could not, since the jerkiness was the air. `--jitter-frames` was
built after the diagnosis above and lived **only on the Pi's SD card**, across `main.c`,
`display.h` and `session.c`; it was never committed and never in the working tree. It is gone now:
the repo was deployed over it, the option is rejected as an unknown argument, and the service args
no longer carry it.

It was strictly dominated on a wired link. Three `perf.js` runs, same shader, same 20 s:

| | fps mean | fps min | `arrive` | max |
|---|---|---|---|---|
| `--jitter-frames 4` | 57.4 | 37 | 78 early / 1008 on time | 24.1 ms |
| `--jitter-frames 0`, code still in | 55.4 | 38 | 0/1052/0/0/0 | 18.9 ms |
| **buffer removed** | **59.1** | **59** | **0/1063/0/0/0** | **17.8 ms** |

At 4 frames it cost 67 ms of latency *and* measured worse, because the 2 ms poll it needs to
present on its own clock perturbs the read cadence. Removing the code recovered the frame rate to
a solid 60 — both runs with the code present sat at a min of ~37, so that looks real rather than
noise, though the rebuild and the removal happened together and the mechanism was not isolated.

The lesson worth keeping: **a mechanism that plausibly explains the symptom, and is genuinely
worth having, can still be the wrong answer** — the same trap as the WiFi power-save wrong turn
recorded above. Both were reasonable, both were built, neither was the cause.

**Power is the failure mode that impersonates the bug.** The Pi is fed 5 V on GPIO pins 4 and 6;
the laptop-side hub is bus powered and cannot run it (900 mA budgeted, 1.2-1.5 A wanted at boot).
It was briefly run that way during the rewire and the evidence is unambiguous: two
`Undervoltage detected!` events, and `get_throttled` latched `0x50000` (bits 16 and 18 — it *has*
undervolted and *has* throttled). An undervolted Pi throttles, which delays the render loop, which
looks exactly like the jitter this whole exercise removed. On GPIO it reads `0x0` on a clean boot
and holds `0x0` through a ramp to four busy cores with the ARM clock pinned at 1800 MHz.

**The link-local trap, and it cost an afternoon.** Restricting avahi to `usb0` is not enough on
its own: `usb0`'s only IPv6 address is a link-local, `getaddrinfo` returns the AAAA *first*, and
`fe80::...` cannot be used by a browser because a URL has nowhere to put the zone id. So Electron
resolved `hub75-01.local`, got `fe80::75:10ff:fe00:2`, and could not connect — while `curl`,
`ping`, `dns-sd` and every shell check kept working, because they fall back. The wall showed a
dashed green line and every test said the display was fine. Over WiFi the AAAA was a ULA
(`fdd8:...`), globally scoped and usable, which is why this only appeared once the link moved.
`ipv6.method disabled` on the connection is the fix; `use-ipv6=no` in avahi is **not** sufficient,
it still registers the record. One-line check: `dns.lookup(name, {all:true})` must return exactly
one entry, family 4.

### The day the link moved, 2026-09-05: three faults stacked, and how they masked each other

Moving the link to USB took a morning rather than an hour, because **three independent faults were
live at once** and each one made the previous fix look like it had not worked. Recorded because the
*shape* of this is the lesson, not the individual bugs.

| # | fault | symptom | fix |
|---|---|---|---|
| 1 | GPIO power jumper: ~0.8 Ω of **contact** resistance | Pi throttled to 600 MHz, rebooting | soldered the joint |
| 2 | Card lost its geometry on power cycle | green lines / garbage on the wall | replayed every boot as a stopgap — **later removed**; the real fix was flashing the config properly in LEDVISION (2026-09-05, below) |
| 3 | avahi on `usb0` published an IPv6 **link-local** | Electron could not resolve the name | `ipv6.method disabled` |

Only the third was self-inflicted by this work. The wall's garbage — which looked exactly like the
USB change having broken something — was fault 2, and predated it.

**What made this expensive: every layer tested green while the wall stayed broken.** The Pi
rendered the right picture (`/frame.raw` read back as a correct kaleidoscope), transmitted at
exactly the documented rate (61,686 packets/2 s = 60 fps x 514, `tx_errors 0`), the link was up at
1000 Mb/s, the card answered discovery and counted packets, and `mock/selftest.js` passed 64/64
with `app-check.js` 11/11. Every check that existed passed, and the wall showed a green line —
because the one thing nothing tested was the card's **geometry**, which the discover reply does not
report.

**The measurement that finally located it** was running the *pre-reconfiguration* command
(`--size 64x32 --canvas 1280x256 --offset 1088,0 --row-map 2 --panel-rows 32`) and looking. It
produced coherent colour bars, rotated 90°, on part of the wall. Coherent output is the whole
finding: the card decodes, the panels light, the ribbon carries data — so the hardware was never
the problem and the card was simply in its old geometry. Rotated, because the modules are mounted
rotated and the old single-panel command has no `--panel ...:90` to undo it. Reaching for a known
*wrong* configuration to prove what the card is holding is worth remembering.

**Undervoltage impersonates every other fault.** A Pi at 600 MHz cannot pace 514 packets a frame,
so fault 1 plausibly contributed to fault 2's symptom *and* to the first config replay failing.
`get_throttled` is the cheapest check in this project and should be the first, not the fifth: low
16 bits are live, high bits latch. `0x50005` is "undervolted right now"; `0x50000` is "was, isn't".
The tell that it is a **contact** rather than a supply: the busbar measured 5.1 V and the implied
resistance was ~0.8 Ω, which is contact-resistance territory — a good crimp is milliohms, and you
would need metres of thin wire to get there. Reseating changed it from *constant* undervoltage to
*oscillating* every few seconds, which is the signature of a joint making and breaking; soldering
it gave `throttled=0x0` latched through a sustained four-core stress, which the jumper never
managed even at boot.

**The bus-powered hub is a weak link.** It vanished from the Mac's USB tree entirely — not just
the Pi behind it — twice, both times immediately after the Pi lost power, and came back only when
re-plugged. The likely mechanism (not proven; no over-current entry surfaced in the macOS log) is
that the Pi's discharged 5 V rail looks like a heavy load on the hub's VBUS and trips its
over-current latch. A wall that loses its control link whenever the rig is switched off and on is
not usable for performance: connect the Pi straight to a Mac USB-C port, or use a self-powered hub.

### The idle pattern, and what it immediately found

`--idle-pattern` (default `corners`) draws four small white Ls, one per corner, whenever **nothing
is bound** — and yields the instant a visual binds. It is deliberately NOT `--test-pattern`, which
*overrides* a bound layer (`session.c`, the `testPattern != PATTERN_OFF` branch) and so silently
swallows every visual sent to a display left with one set. The startup banner used to say a test
pattern ran "until a host binds a layer", which is simply untrue and cost real confusion here; it
now says it overrides. Nine checks in `selftest.c` cover the shape, the arm direction in each
corner, that the centre stays dark, and that a typo is rejected rather than silently blanking the
wall.

It earns its place immediately: **black tells you nothing.** Four crisp Ls in the right corners say
the Pi is up, the card is configured, the panel map is right and the output stage works — from
across the room, with no laptop. That is the question that consumed 2026-09-05.

And it found something within minutes of existing. **Every diagnostic used until then was a
FULL-SCREEN pattern** — `bars`, `cellid`, `white` — and a full screen masks a half-configured card
almost perfectly. The idle pattern was the first mostly-black thing the wall had ever shown, and
the green lines it exposed had been there all along. A test that paints every pixel cannot tell you
whether the card is right; one that paints twenty can.

### Resolved 2026-09-05: the card holds its config in flash; the boot-replay is gone

The card now keeps its 192×64 configuration across a power cycle and cold-boots correct on its
own — proven by a card-only power cycle (no Pi in the loop) and by a full cold boot with the replay
removed. The fix was in LEDVISION, not on the Pi: flash **both** saves — *Receiver Parameters →
Save to Receivers* **and** *Receiver Mapping → Save to Devices* (the latter never done before) —
over a confirmed gigabit link. Full account in `LEDVISION-CONFIG.md`.

So `limut-hub75-cardconfig.service`, which replayed a capture every boot and half-configured the
card (idle Ls in the right corners, green lines alongside) while the identical file replayed by
hand was perfect every time, has been **removed entirely** — the unit, its `enable`, and the
renderer's `Wants=`/`After=` on it, on both the Pi and in the repo. The boot-vs-by-hand mystery was
never solved and no longer needs to be; a plausible unproven cause is that it replayed the
**09-04** capture, which predates the *Save to Devices* write and so was structurally incomplete.

**The method that cracked every real fault here, kept because it is general: change one variable
against a known-good baseline** — card provably correct, change only the content. It settled in
ninety seconds what an hour of mechanism-guessing did not. Its corollary is why the idle pattern
exists: a full-screen pattern (`bars`/`cellid`/`white`) masks a half-configured card, while the
20-pixel idle pattern exposes anything the card adds of its own.

**Recovery, now that the name is USB-only.** wlan0 stays associated but unadvertised, so
`hub75-01.local` no longer resolves over WiFi and `deploy.sh` needs the cable in. The way back is
the address: `ssh pi@192.168.68.58`. Give the Pi a DHCP reservation on the router, or a moved
lease leaves the router's client list as the only way to find it. Full rollback is deleting
`allow-interfaces=usb0` from `/etc/avahi/avahi-daemon.conf`.

### The instrumentation, and why the old telemetry could not see any of this

`pi/pacing.h` and `pi/pacing.c` are new, and `/debug` and the 1 Hz `stat` message both carry a
`pacing` object now. Four series — `host`, `arrive`, `draw`, `render` — each as a per-second count,
mean, max and a five-bucket distribution in frame times (early / on time / 1 late / 2-4 late /
stalled). `hub75 status` in the app prints them, and so does `pi/perf.js`.

It needed no protocol change: `seq` and `hostTime` have been in every frame packet since v1 and
were decoded and then never read. Comparing `host` against `arrive` is the whole diagnosis.

**Two things about the old numbers actively hid this**, and both are worth not reintroducing:

- **`fps` is a whole-second count**, so a second containing a 120 ms freeze and then a catch-up
  burst still reads 49 and looks merely a bit low. It cannot represent a stall at all.
- **`renderMs` was the last frame's value**, sampled once a second, i.e. one frame in fifty. It
  read a steady 3.8 ms throughout while the true per-second maximum was 23-30 ms. It is now the
  max over the reporting window, and `pacing.render.mean` is the old sense of the number.

Buckets are centred on one frame rather than starting at it (edges 0.75, 1.5, 2.5, 5) so that the
healthy case sits in the middle of a bucket instead of on a boundary where a microsecond of jitter
flips it.

### An empty frame is not a redraw, 2026-09-05

Found immediately after the canvas change, by reading `pacing` rather than the wall: the daemon was
drawing a rock steady **120 fps** at idle, 7,933 packets/s, with `pacing.draw` reading
**`[60 early, 60 on time]`** — the signature of two independent 60 Hz sources rather than one
doubled clock.

Both sources were legitimate on their own. limut had a session open with **nothing bound** (the
normal state after `Ctrl-.`), and `host/hub75.js` streams `layerCount: 0` frames at 60 Hz on
purpose, to keep `dim`, `beat` and `hostTime` live on one code path. Each of those set `haveFrame`
and drove a redraw. Meanwhile `freeRun` in `main.c` guards only on `!layerBound`, so the idle
pattern's own clock drove a second 60. Sixty plus sixty.

The fix is one condition in `session.c`: **a frame carrying no layer has no picture in it, so it is
not a reason to redraw** — only a change of `dim` is, since the dimmer changes what the panels show.
Written up as a MUST in `PROTOCOL.md` §12.1 and applied to `mock/display.js` too, so the reference
display and the C daemon still agree. Three checks in `mock/selftest.js` cover it, and they run
against both.

Worth noting what was *not* done. The obvious fix is to make `freeRun` back off while frames are
arriving, and that was the first plan. It is the wrong layer: it treats a content-free packet as
real work and then compensates, where the accurate statement is that the packet was never work.
Guarding `freeRun` would also have left the same double-draw in place for a bound layer, where
`freeRun` is already off.

**The bug was always there; the canvas change only made it visible.** At 514 packets a frame the
output stage took long enough that the loop could not fit two draws into 16.7 ms, so the doubling
was clipped to 60 and looked correct. Making the output eight times cheaper unclipped it. A latent
fault held down by a slow path is the third time this project has met that shape.

**And a measurement habit that paid off twice in one evening:** the first reading was `fps 120` with
`dropped 8`, which looks like a daemon in trouble. `fps` is a whole-second count and says nothing
about structure; `pacing.draw`'s buckets said "two 60 Hz sources" in one line. The `dropped 8` was
unrelated and never climbed again — it happened during a `deploy.sh` build pegging all four cores.

### Two loop fixes made at the same time

Both found while reading, both correct regardless of the stutter, neither of them the cause:

- **The Colorlight socket asked the kernel to clone every packet on the machine.**
  `socket(AF_PACKET, SOCK_RAW, htons(ETH_P_ALL))` registers a *receive* hook, so every packet on
  every interface in both directions — including our own ~30,000 tx packets/s, via
  `dev_queue_xmit_nit` — was cloned into a queue nothing ever read. A transmit-only socket wants
  protocol `0`. (`tools/colorlight-probe.c` genuinely needs `ETH_P_ALL`; it reads replies.)
- **`sendmmsg` slept mid-frame for want of a send buffer.** One frame is ~0.5-0.7 MB of skb
  truesize against a default `wmem` of ~208 KB. The daemon is single threaded, so every sleep is
  time the WebSocket is not drained. It now asks for 4 MB, and the unit raises
  `net.core.wmem_max` in `ExecStartPre` — `SO_SNDBUFFORCE` would need `CAP_NET_ADMIN` and the unit
  grants only `CAP_NET_RAW`.

And on the host side, `electron-main.js` now sets `backgroundThrottling: false`: rAF is the send
clock for the wall as well as the canvas, so an occluded window would throttle the LEDs. The
`disable-renderer-backgrounding` switch was already there and is the process-level half of the
same thing; this is the per-window half that actually governs rAF.

### v3d's shader compiler segfaults, and it takes the daemon with it (2026-09-06)

**A px chain can kill the display, and nothing on either end survives it.** Found with the fire
shader:

```
v visualsynth, px=set{v:id.v-time,z:time/3}>>fbm3{scale:3/2}^3*2>>mul{1/2-uv.v/2}>>pal{0,red*3/4,yellow,1}, display='hub75-01'
```

The journal is unambiguous:

```
MESA: error: Failed to compile MESA_SHADER_FRAGMENT prog 1/1 with any strategy
limut-hub75.service: Main process exited, code=killed, status=11/SEGV
```

"with any strategy" is Mesa having exhausted every register-allocation strategy it has; it then
**crashes instead of returning a compile error**. `Restart=always` brings the daemon back, limut
reconnects and resends the same program, and it dies again — eight restarts before it was stopped.
So the failure never reaches `render.c`'s `GL_COMPILE_STATUS` check and no `error kind:"compile"`
is ever sent. **The whole error-reporting design assumes a failed compile returns.**

**It is not a size problem, and every number said so.** 10,033 wire bytes (17% of the 60 KB cap),
83 uniforms of the 512 allowed, 288 lines, one compile with byte-identical source. What v3d cannot
take is `fbm3`'s four unrolled octaves — **33 `l_pxhash` calls**, each a pcg4d integer hash, in one
straight-line fragment shader. The V3D 4.2 has far less register file than the desktop GPU that
compiles the same source in a browser without complaint.

**Verified working alternative:** `fbm3` → `fbm2` — 6,031 bytes, 51 uniforms, 17 hashes. Binds on
the real wall, 14,600 frames rendered, `pacing` 60/60 on time both host and arrive, zero restarts.

**Fixed the same day, in `pi/compile_guard.c`: the compile is tried in a forked helper first.**
The helper holds its own GL context and does nothing else; if it dies, the parent survives and
turns the death into an ordinary `error kind:"compile"` — permanent for that source (§8), so limut
stops resending it and the crash loop is broken by the same change that contains the crash.
Verified on the wall: the fire shader now produces one `🔴 shader compile error` in the limut
console, the session stays open, `NRestarts` stays 0, and a working chain binds immediately after.

**The helper must DRAW, not merely compile and link — and this is the part that is easy to get
wrong.** The first version compiled and linked in the child, reported the fire shader as
completely fine, and the parent then died on the next frame one second later. **v3d generates the
hardware fragment code lazily, at the first draw with the real pipeline state**, so `glLinkProgram`
succeeding proves almost nothing. The daemon said "compiles guarded in a child process" in its
banner while guarding nothing. The helper now renders one frame through the program.

**What crosses the wire is one short line.** It is read in the limut console by someone in the
middle of playing, so it says what is wrong and what to change — `too complex for the GPU's shader
compiler; simplify the chain` — and nothing else. The signal number and the fact that it was a
*crash* rather than a rejection go to the daemon's own log (`cguard.lastCrash`), because that is
diagnosis and diagnosis is not what a live coder needs from a shader that just failed. Three
checks in `selftest.c` hold the wire message to one line and under 80 characters. The host prints
a short single-line log inline rather than on its own line; a driver's own multi-line GLSL
diagnostics still get the block treatment.

Two smaller things the episode settled:

- **The startup probe earns its place.** `main.c` puts a trivial shader through the helper before
  trusting it, and the banner reports the *result* rather than the fact that a child was forked.
  A guard that reports its own existence rather than its own function is how the above went
  unnoticed for a build.
- **A dead child must not kill the parent through SIGPIPE either.** `write()` to a socket whose
  peer has died raises it, and `main.c` happening to ignore SIGPIPE would have made this file
  correct only by luck. It uses `MSG_NOSIGNAL`/`SO_NOSIGPIPE` instead. Found by `selftest.c`,
  which does not ignore SIGPIPE and died on exactly this.

**And the host no longer binds optimistically** (`host/session.js`): a layer is not treated as
bound until `progok`, because the display compiles on receipt and the seconds that takes were
being spent streaming frames that named a layer the display had not bound. See PROTOCOL.md §7.1
for the rule and for the one residual gap (a cached-failed program gets no second `progok`).

**And the diagnosis only took one run because the close code is now reported.** `1006 no close
frame - the display died or the link dropped` is what separates "the display rejected it" from
"the display died"; before 2026-09-06 both printed the same bare `disconnected` and this had been
an open ToDo entry, mis-filed as a CORS problem, for days. The "cors error" was only ever the
`/info` probe firing during the two seconds systemd takes to restart.

### The wall held a white frame across every shader edit (2026-09-09)

**Livecoding a display-bound visual, the wall would stick on a broken picture for a second or two
after an edit — usually flat white, sometimes a partial render in wrong colours — and then recover
on its own.** Four separate faults, in a chain, each of which is a bug by itself. What made it hard
to see is that no single one of them is visible from either end: the host logged a disconnect
nobody was watching, the daemon logged nothing at all, and the wall was the only place the whole
thing showed.

1. **The host sent `layer` alongside `prog`** (`host/session.js`, `pumpUploads`). `s.bound` — and
   with it the uniform count in the frame stream — only advanced on `progok`. The display compiles
   on receipt and **blocks its entire loop doing it**, so that gap is seconds wide, and across all
   of it limut was streaming the *old* program's uniforms at a display that had already rebound.
2. **`handle_layer` redrew unconditionally** (`pi/session.c`), so the daemon drew the **new**
   program from the retained **old** frame. `render_frame` truncates to `min(count)`, so surplus
   uniforms of the new program sat at zero and shared slots carried another program's meaning. That
   is the white frame. Nothing else in the render path can produce one — `render_frame` clears to
   opaque black — which is what made the render path the wrong place to look.
3. **The next frame packet closed the session**: its uniform count no longer matched the bound
   program, which §12.1 makes a protocol error.
4. **And nothing then fed the card.** `display_on_close` leaves `layerBound` set, so `main.c`'s
   free-run clock — gated on `!layerBound` — stayed off, and there is no output thread and no
   watchdog anywhere below `display_draw`. So the garbage frame from step 2 was *held* until the
   250 ms-backoff reconnect rebound the layer. That is the "for a while", and the reconnect is the
   "recovers on its own".

**Fixed at all four points**, because each is a hole on its own:

- `host/session.js` holds the `layer` until `progok` (PROTOCOL.md §7.1, now a MUST NOT **send**
  rather than a MUST NOT bind). This is the one that removes the fault: the old program stays bound
  and its uniforms stay valid for the whole compile, so the wall keeps showing the old visual, live
  and animating, right up to the swap. A program the display already holds still binds immediately
  — it sends no second `progok`, so waiting for one would leave the layer unsent forever, which is
  what `needsAck` is for.
- `pi/session.c` redraws on a rebind only when the frame it is holding fits the program now bound,
  and `display_draw` refuses to draw a bound program from a frame of the wrong shape. That second
  check matters on its own: a `layerCount: 0` frame lands as `uniformCount 0`, so a redraw forced
  by `hello` on a reconnect used to repaint a live wall white with nothing in any log.
- `render_frame` was deliberately **left** permissive. `compile_guard.c` draws with no uniforms at
  all, on purpose, to make v3d generate the fragment code — so the count rule belongs at the session
  layer and putting it in the GL primitive would have disabled the compile guard.
- `main.c`'s clock now has two jobs: redraw the pattern when nothing is bound, and **re-send the
  last frame** (`display_hold` → `output_resend`) when a layer is bound and the loop drew nothing.
  That is the general fix for step 4 and covers every other starvation state too — a dead session, a
  host streaming `layerCount: 0`, a layer waiting for a frame that fits. It is taken only when
  `display_draw` produced nothing, checked against `out.frames`, so it can never double up with a
  real frame the way the empty-frame redraw did at 120 fps on 09-05. `stat.held` counts it: a
  `held` climbing while `rendered` does not is a wall being frozen rather than driven.

**What it cannot cover, and this is the honest limit:** a stall *inside* the loop. A compile is
exactly that — `cguard_check` blocks — and no clock in a single-threaded daemon runs while the
thread is blocked. So the compile window itself is still an unfed card. Two things to measure before
deciding whether that matters: how long a real compile actually takes (worth timing in
`handle_prog` regardless), and what a starved 5A-75B actually does — stop the daemon with a visual
up and watch. If it holds, this is a nicety; if it goes white, the guard round-trip wants to be
asynchronous (the helper is already a separate process, so it is a matter of putting its fd in
`net_poll`), and even then the parent's own `render_build_program` blocks and the output stage would
have to leave the main loop. Do not start that before the measurement.

**What each end is tested by.** The host rule is `mock/host-check.js`'s new `slowcompile` scenario
and two inline `?test` cases in `host/session.js`; the display rule is a check in
`mock/selftest.js`, which runs against the mock and the real daemon alike (`--endpoint`), and it is
worth knowing why it is shaped the way it is: it lets the frame be **drawn** first and then rebinds,
rather than sending frame and layer back to back. The back-to-back version races — a display that
draws on arrival may legitimately have drawn the frame before the layer lands, and then correct and
incorrect behaviour are indistinguishable from a frame count. Letting it draw and then asserting the
rebind adds no second draw tests the faulty line exactly. `output_resend` is covered in
`pi/selftest.c`.

**Why the suite never caught it.** `mock/host-check.js`'s `edit` scenario uses two chains that
deliberately **share one program id** — it exists to prove a lut change rebinds when the GLSL does
not — so the uniform count never varied, and the mock acked instantly, making §7.1's window one
loopback round trip. The new `slowcompile` scenario fixes both: `display.js --slow-compile MS`
defers every `progok` while still serving everything else, and the scenario edits between two chains
of **different** uniform counts, asserting that each `layer` arrives at least a compile-time after
its `prog`. Run against the pre-fix host it reproduces the fault exactly —
`🔴 protocol error: frame has 0 uniforms, program 896020e7 declares 1`, then a 1002 disconnect. A
scenario that cannot fail against the code it was written for is not evidence, so that check is
worth repeating on any change here.

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
32 wide x 64 tall in the display), forming two **side-by-side full-height columns**. That gives a
**64 x 192** portrait panel, a 1:3 aspect ratio, 960 x 480 mm of wall. (Corrected 2026-09-04: the
chains are left/right columns, not top/bottom halves as first recorded.)

**The ports are J1 and J2**, not J1 and J8 as recorded here before the card was configured.
LEDVISION drives a cabinet's data groups on **consecutive** ports and reaching a non-adjacent one
would mean padding the run with ~12 void groups, so the cabling was moved rather than the config
contorted — see `LEDVISION-CONFIG.md`. Which physical module ends up in which canvas cell is then
decided by the cabinet's cascade, not by the port numbers, and is read off the wall with `cellid`
rather than reasoned about; the answer for this wall is in "The wall as driven, 2026-09-04".

Two consequences worth having written down before the card is configured:

**This is the number that justifies configuring the card.** 64 x 192 is 12,288 pixels, against the
655,360 an untrimmed 1280 x 512 canvas transmits to light them. At 3 bytes per pixel and 60 Hz that
is **2.2 MB/s rather than 120 MB/s** — and 2.3 MB/s is exactly what it now measures, since
2026-09-05, at `--canvas 192x64`. Frame rate is no longer a bandwidth question at all. It is also far inside the 128 x 1024 normal-chip ceiling,
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

**But it is the CABINET, not a "screen"** — corrected 2026-09-05. It read 1280 x 512 here because
the *factory cabinet* was 1280 x 512; once the cabinet was reconfigured it reads `00 c0 00 40`,
i.e. 192 x 64. `colorlight-probe.c` labels it correctly and always did. Every archived reading of
1280 x 512 comes from a discover taken **before** that session's config write — in
`ledvision-config-20260905.pcap` the detect is at 16:47:04 and the pushes at 16:55:42 and
16:56:08, so neither capture contains a post-write detect. This field never described a screen,
and reading it as one is what produced the "the card wants a 1280 x 512 screen" error below.

### The card as found, and how to drive it

Established on the bench 2026-08-29, one P5 64x32 module on J1:

| | |
|---|---|
| Cabinet | **1280 x 512** as reported, i.e. 1280 x 256 in panel space — the FACTORY cabinet, not a "screen" (see above) |
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

### The wall as driven, 2026-09-04

The card was reconfigured with LEDVISION on 2026-09-04 (`LEDVISION-CONFIG.md`) and the whole
64 x 192 portrait wall now runs. What the reconfiguration did and did not change is the thing to
have straight, because getting it wrong cost most of this bring-up:

| | |
|---|---|
| Cabinet | **changed**: a 192 x 64 receiver window, at the canvas **origin** |
| Scan | **changed**: 1/16, matching the panels, so `--row-map 1` |
| Screen / canvas | **there is no such thing** — corrected 2026-09-05. The card latches on the sync packet, not on having received a whole screen, and the canvas is simply the wall: **192 x 64**. See "There is no card-side screen size" below |
| Colour order | unchanged, `bgr` |

> **The paragraph that stood here was wrong, and is kept below struck through because the shape of
> the error is the lesson.** It claimed the card has a screen size separate from its receiver
> window, that the screen was still 1280 x 512, and that the card would not latch until a whole
> screen had gone out. None of that is true. See "There is no card-side screen size", 2026-09-05.

~~The card's screen size and its receiver window are separate, and only the window was
reconfigured. A 192 x 64 cabinet at the origin looks exactly like "send a 192 x 64 canvas", and
that goes black — the card wants a full 1280 x 512 screen per sync whatever size window it is
showing. Two independent things agreed: the discover reply's `d[21:24]` still reads 1280 x 512,
and a bare 192 x 64 canvas is dark.~~

**Why it was believable:** the two "independent" confirmations were not independent. `d[21:24]`
is the cabinet field read before a write (above), and the black wall is a real observation with a
different cause — it was made on 2026-09-05, the day three faults were stacked and the Pi was
browning out at 600 MHz.

`--trim-canvas` was the workaround for the imaginary screen, and it did work — every canvas row
still goes out, in order, but only the 192 columns the wall occupies. It is **no longer used**,
because the canvas is now just the wall. Kept in the daemon as the recovery path for a card that
has lost its configuration and is back to a big factory cabinet:

| | 1280 wide | trimmed to 192 | **canvas 192x64** |
|---|---|---|---|
| packets/frame | 1538 | 514 | **66** |
| rate | 120 MB/s, 46 fps | 18 MB/s, 60 fps | **2.3 MB/s, 60 fps** |

The working command, which is what `pi/limut-hub75.default` now installs:

```sh
limut-hub75 --output colorlight --iface eth0 \
    --size 64x192 --canvas 192x64 --row-map 1 \
    --color-order bgr --brightness 100 \
    --panel 0,128:0,0:64x32:90  --panel 0,64:64,0:64x32:90  --panel 0,0:128,0:64x32:90 \
    --panel 32,128:0,32:64x32:90 --panel 32,64:64,32:64x32:90 --panel 32,0:128,32:64x32:90
```

**The panel map, read off the wall with `cellid`.** Colour gives the canvas cell column, the black
squares its row, and the black L its top-left corner:

| wall module | render region | canvas cell | rot |
|---|---|---|---|
| left top | 0,0 | 128,0 | 90 |
| left middle | 0,64 | 64,0 | 90 |
| left bottom | 0,128 | 0,0 | 90 |
| right top | 32,0 | 128,32 | 90 |
| right middle | 32,64 | 64,32 | 90 |
| right bottom | 32,128 | 0,32 | 90 |

Note the canvas column runs **bottom to top** of the wall and the canvas row runs **left to
right** — a consequence of the 90 degree mounting plus the cabinet's own cascade, and not
something to guess at. `cellid` answered it in one look; `map`'s numerals could not be read at
all on a sideways panel, which is why `cellid` exists.

### There is no card-side screen size, 2026-09-05

**The card does not have a "screen" that a frame must fill before it will latch.** It latches when
it is told to, on the `0x01` sync packet. The canvas is whatever the sender chooses to send, and
for this wall that is simply **192 x 64**: `--canvas 192x64`, no `--trim-canvas`, **66 packets per
frame and 2.3 MB/s** against the 514 and 18 MB/s that shipped before.

**How it was settled, and the method is the point: watch a known-good sender.** LEDVISION was on
the wire driving this wall, so instead of reasoning about the card, count what LEDVISION actually
sends. `tcpdump -i en5 "ether[12] == 0x55 or ether[12] == 0x01"` for five seconds, twice:

| LEDVISION screen | rows on the wire | `d[4:5]` count | frame len | packets/frame | latch |
|---|---|---|---|---|---|
| as found (256 x 256) | 0..255 | 256 | 789 | 257 | 20 fps |
| set to 192 x 64 | **0..63** | **192** | **597** | **64** | **49 fps** |

The wall was correct in both. A sender putting 64 rows on the wire and getting a lit wall is
proof no 1280 x 512 is required, and it took five seconds to obtain. **The card had been the
suspect for a week without anyone measuring what already worked.**

**"Screen Size and Count" is a LEDVISION setting, not a card setting.** It lives in its own dialog
off the main window, not in *LED Screen Settings*, and it has only an Apply — no Save, because
there is nothing to persist. Apply emitted **zero frames**: the whole session's config-frame count
was `0x07 x5` and one `0x08` reply, and nothing else — the whole of it is checked in as
`ledvision-screensize-20260905.pcap`, 6 frames. That is why no capture of a screen-size write
exists to replay — the write does not exist.

**Measured on the Pi after the change**, `--canvas 192x64`, six modules, 20 s of `perf.js`:

| | 1280x512 --trim-canvas | **192x64** |
|---|---|---|
| packets/frame | 514 | **66** |
| wire | 18 MB/s, 30,943 pkt/s | **2.3 MB/s, 3,973 pkt/s** |
| `renderMs` mean / max | 1.55 / 3.92 | **0.94 / 0.98** |
| `arrive` pacing | — | 1/1102/1/0/0 over 1105 frames |
| fps / dropped / `throttled` | 60 / 0 / `0x0` | 60 / 0 / `0x0` |

Clean across a reboot. **`eth0` transmit drops are zero at *both* sizes** — measured 10 s each way,
30,891 and 3,966 pkt/s, 0 dropped — so the deepened transmit queue is doing its job and none of
this is a fix for that.

**The trap that cost the most, and it is a general one: two confirmations that are secretly one.**
"The screen is 1280 x 512" rested on the discover reply reading 1280 x 512 *and* on a bare 192 x 64
canvas going black. They look independent. They are not — the first is the cabinet field read
before a write, and the second was observed on the day three faults were stacked and the Pi was
browning out at 600 MHz. Neither was evidence about a screen.

### Configuring the card from the Pi: replaying a capture (RAM only, manual)

**This works as a RAM write, verified 2026-09-04** — a 5A-75B can be configured from the Pi over raw
ethernet, no Windows machine, by replaying a captured LEDVISION session without decoding it. But it
**never persists** (RAM, not flash), so it is now only a **manual diagnostic** — there is no boot
service doing it (removed 2026-09-05) because the card holds its own flash config. Persistence comes
from LEDVISION's two flash saves, not from this. The bytes LEDVISION wrote are still the spec.

| | |
|---|---|
| `tools/extract-config.py` | lifts a configuration out of a LEDVISION pcap |
| `tools/colorlight-config.c` | replays one onto a card. Dry run by default; `--write` to commit |
| `colorlight-config-64x192.clcfg` | this wall's configuration, as flashed |

**Telling a `Send` from a `Save to Receivers`, on the wire.** LEDVISION's `Send` writes RAM and is
how you iterate; only `Save to Receivers` commits to flash. A save is distinguishable by a **tail
block the plain pushes do not have** — an extra `0x26` run, ~208 `0x06` frames, then 12 `0x19`
per-module geometry records. The captured session holds **2 saves among 12 pushes**, and
`extract-config.py` picks the last save by default.

**How it was proven, and why the obvious test proves nothing.** Replaying the card's *own current*
configuration changes nothing — it is a no-op by construction, and reading back "no change" says
only that the write was redundant. This wasted a lot of time here before the flaw was spotted. The
test with any power is to write a **different** configuration and read back:

| | `reg 4c` |
|---|---|
| the working config (save 1) | `0x1f` |
| after writing save 0 | `0x02` |
| after restoring save 1 | `0x1f` |

Reproducible, in both directions. `colorlight-config` is therefore a real tool and not a hopeful
one. The two saves differ in exactly the places you would expect — the `0x17` header by 193 bytes,
`0x18` by 289, and the per-module `0x1b`/`0x19` records by 3 bytes each — while `0x26`, `0x32`,
`0x76` and `0x1f`, which carry the panel's own wiring, are byte-identical between them.

**The read primitive that makes this checkable.** LEDVISION's `0x06` (memory, address at `d[4:8]`)
and `0x19` (register, index at `d[8]`, count at `d[12]`) requests are answered with an `0x09`:
`d[0]` status, `d[1]` count, `d[2..]` the value — and **the rest of the 1070 byte frame is stale
buffer left over from earlier replies**, which reads convincingly as data and is not. Replaying
those requests from the Pi reads the card's stored parameters stably and reproducibly. That is
what turns "did that write land?" into an automatic before/after diff instead of a question for
whoever can see the wall. Read the *live* column when scripting it: the tool prints the captured
value alongside, and picking the wrong column silently compares two constants.

Two things worth not re-deriving, both measured from the capture rather than argued:

- **LEDVISION stops its 60 Hz sync stream while writing a configuration** — 1 sync frame in the
  20 s of a save, against 11.5/s across the session. Replaying silently is faithful.
- **No fresh handshake is needed.** LEDVISION detected the card at t=10 s and configured it
  successfully from t=2391 s onward, 97 minutes later.

**There is nothing left that this cannot reach.** The "card screen size" that used to be listed
here as the one Windows-only geometry **does not exist** — see below. Applying a configuration is
a solved, Windows-free operation; only *capturing a configuration that has never been captured*
(a different wall, different panels) still needs LEDVISION.

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

- **The configuration lives in the card's flash and is written once** (persistence across a power cycle verified 2026-09-05). After that the card runs
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
- the mock's own assertions still pass, and the same suite passes against the C daemon over
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

**The whole six-module wall runs, 2026-09-04.** All 64 x 192 of it, in portrait, through the panel
map: a solid 60 fps, zero transmit drops, and the installed service arguments in
`pi/limut-hub75.default` are the verified ones. (It ran at 514 packets per frame through
`--trim-canvas` until 2026-09-05, and at **66** since — see "There is no card-side screen size".)
Verified in layers:

- 198 unit checks in `pi/selftest.c` (228 as of 2026-09-04 with the pacing checks; 248 as of
  2026-09-05, which lock the shipping 192x64 canvas to one packet per row)
- the mock's own suite against the real daemon over the network: **all of it**
  (`mock/selftest.js --endpoint hub75-01.local:7575`), which compiles a program on the Pi's V3D
  and holds a uniform stream
- the wall itself, by eye, through `white` (does anything light), `cellid` (which canvas cell is
  each module) and `bars` (is the portrait image coherent, and is the colour order right)

`pi/app-check.js` — the browser leg, the real app driving the real display — **passes 11 of 11**,
but only after a wrong diagnosis worth recording. It first failed every check with `cannot reach
http://hub75-01.local:7575/info (Failed to fetch)`, which matches this project's own documented
macOS Local Network signature exactly: the failure takes **3.6 ms**, far less than a round trip,
and `mode: 'no-cors'` fails too. It was **not** that. **Chrome's resolver does not do mDNS**, so a
`.local` name that Node, `curl` and the shell all resolve is simply unreachable from the page, and
it fails with the identical signature.

**The discriminator is to try the IP**, and it should be the first thing tried, before touching
any permission: `hub75-01.local` failed in 3.6 ms while `192.168.68.58` succeeded in 18.6 ms from
the same page, in the same browser, in the same run. Fails-fast on both is a permission problem;
fails-fast on the name only is mDNS. `app-check.js` now resolves the name with `dns.lookup` and
hands the browser an address, so it works with a `.local` argument or with none.

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

- ~~**Does the Colorlight implementation actually work?**~~ — **yes, fully, as of 2026-09-04.**
  The whole six-module 64 x 192 wall runs from it at 60 fps with zero transmit drops, through the
  panel map, which was written blind against other people's documentation and turned out correct.
  `--trim-canvas` was too, and is now unused: since 2026-09-05 the canvas is just the wall.
- ~~**Can a configuration be written to the card from the Pi?**~~ — **yes, verified 2026-09-04.**
  `tools/colorlight-config.c` replays a captured configuration and the card takes it, proven by
  writing a *different* config and reading the change back, both ways. Windows is now needed only
  to **capture** a configuration that has never been captured before, never to apply one.
- **Can a configuration be *composed* rather than replayed?** Only replay works today. The route
  map (`0x26`) and the index/offset tables (`0x32`, `0x76`) are byte-identical between the two
  captured saves while the header (`0x17`) and per-module records (`0x1b`, `0x19`) differ by a
  handful of bytes — so diffing captures to find which bytes carry scan, geometry and port
  assignment is now a tractable exercise with a working write path to test each guess against.
- ~~**Configuring the card**~~ — **done 2026-09-04.** The card is reconfigured off its factory
  1280×512/1/32 setup to a 192×64/1-16 cabinet via LEDVISION 8.5 in a Mac-hosted Windows VM, and the
  config-write protocol is captured and partly decoded. See `LEDVISION-CONFIG.md`. Remaining: reproduce
  a config *from the Pi* (diff two captures to find the scan/geometry bytes) — a later nicety, not a
  blocker. The immediate follow-on is the limut landscape→portrait rotation (below / in that doc).
- ~~Whether the 5A-75B's own flashed configuration can express the panel layout~~ — **no, and it
  does not need to.** The modules' 90 degree mounting rotation could not be expressed in
  LEDVISION 8.5 at all, so the cabinet is defined in the modules' native landscape and the
  rotation is a `--panel ...:90` entry in the output stage, exactly the pixel permutation
  `output.h` reserved. It costs nothing: each rotation is a constant stride through the rendered
  image, so there is no rotated intermediate buffer anywhere.
- Whether render + readback + **Colorlight output** still holds 60 Hz. The first two do
  comfortably (0.64 ms at 128x64); the third is written but unmeasured. At 128x64 it is 64
  packets and one `sendmmsg` per frame, so the expectation is that it disappears into the noise —
  but that is an expectation, not a measurement. Re-run `pi/perf.js` once panels exist.
- Frame pacing: the display still renders on packet arrival, self-pacing to the host's rAF, and
  **that is now known to be what makes the wall jerky over WiFi** — see "Why the wall is jerky".
  The arrival cadence is measured (`pacing.arrive`) rather than assumed. Pacing the draw on the
  Pi's own clock is the software answer and was **declined** 2026-09-04 in favour of wiring the
  link; revisit only if it cannot be wired.
- The gamma curve for the panels. The mechanism is in place — a 256-entry table in the output
  stage, applied after the dimmer, `--gamma` on the command line, default 2.2 — but the right
  value is a thing to find by eye once panels exist.
- Time sync: how the Pi's frame cadence relates to limut's metronome/beat clock. `hostTime` is no
  longer merely decoded and ignored — `pacing.host` is built from its deltas, which is what proved
  the host's send cadence blameless. `beat` is still unused. Any real time sync still needs no
  framing change.
- Live texture sources: `webcam{}` is local-only and unsupported in protocol v1. Streaming it (or
  the scope/FFT textures) would need a per-frame texture path that does not exist yet. The host
  refuses to bind a chain containing one.
- Image textures (`tex{'url'}`) are specified but not implemented host side: `draw/texture.js` keeps
  only the GL handle, so the encoded file bytes would have to be fetched separately. The host
  refuses to bind a chain containing one, and `assets.classify` has the seam for it.
- Physical display size and panel arrangement.
- Driving more than one display from one limut, now that the name is pinned to a single USB link.
  A second wall would need a second interface and a second advertised name.

## Answered since

- *USB, and what it needs* — **USB-C gadget mode, CDC ECM, and it needs no protocol change at
  all.** Done 2026-09-05; see "Done: the link is USB" above and PROTOCOL.md §3.2. The question in
  ToDo.txt was "what usb is needed? 2 or 3 or c?" and the answer is **C**: the four USB-A ports on
  a Pi 4B are host ports, and two hosts cabled together never enumerate — only the USB-C port has
  a peripheral-capable controller.
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
