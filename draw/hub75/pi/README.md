# The Pi renderer

The display side of `../PROTOCOL.md`, in C: one binary that speaks the protocol, renders the
shader on the Pi's GPU at panel resolution, and hands the pixels to an output stage.

`../mock/` is the reference implementation of everything here that is not GPU or hardware, and
this follows it path for path. That is not incidental — `../mock/selftest.js` is pointed at both.

## Building

```sh
sh deploy.sh            # rsync to hub75-01, build there, run the selftest
sh deploy.sh install    # ...and install it as a systemd service
sh deploy.sh run        # ...and run it in the foreground instead
make && make test       # or build here, on the dev machine
```

Built natively on the Pi rather than cross compiled: C compiles in seconds even on a 1 GB 4B, the
EGL/GBM headers are the exact ones on the target, and there is no sysroot to keep in sync. The
only packages needed are `libegl-dev libgbm-dev libgles-dev`, all already on the stock image.

**On a machine with no EGL/GBM the GLES half of `render.c` compiles out** and the daemon still
runs, serving the whole protocol with nothing drawn. That is what makes it possible to develop
and test against `mock/selftest.js` on a Mac without touching the hardware, and it is why the
`--no-gpu` flag exists.

`-std=gnu99`, not `c99`: glibc hides `clock_gettime`, `strdup`, `popen` and `memmem` behind
feature test macros, and `-std=c99` turns every one of them into an implicit declaration on the
Pi while compiling cleanly on macOS.

## Running

```sh
./limut-hub75 --name hub75-01 --size 128x64 --output raw --gamma 2.2
```

| flag | |
|---|---|
| `--port N` | listen port (default 7575) |
| `--name NAME` | display name in `/info` and `welcome` |
| `--size WxH` | panel resolution |
| `--node PATH` | DRM render node (default `/dev/dri/renderD128`) |
| `--output` | `null` \| `raw` \| `colorlight` |
| `--iface NAME` | colorlight: interface the card is cabled to (default `eth0`) |
| `--color-order ORD` | colorlight: byte order the panels want, eg `bgr` (default `rgb`) |
| `--brightness N` | colorlight: the card's own panel brightness, 0-255 (default 255) |
| `--canvas WxH` | colorlight: the card's whole screen, when it is bigger than what we render |
| `--offset X,Y` | colorlight: where the render sits in that screen (ignored once `--panel` is used) |
| `--trim-canvas` | colorlight: send only the canvas columns the wall occupies. Every row still goes, in order |
| `--row-map N` | colorlight: 2 when the card scans twice the lines the panel decodes |
| `--panel-rows N` | colorlight: physical rows in one panel, which sets the row-map group |
| `--panel SPEC` | colorlight: place one panel — `SX,SY:DX,DY:WxH:ROT`. Repeatable |
| `--test-pattern` | `off` \| `bars` \| `grid` \| `white` \| `map` \| `cellid` \| `bands` \| ..., shown until a host binds a layer |
| `--pattern-fps N` | rate to re-send a test pattern at, with nothing driving it (default 60) |
| `--gamma G` | output gamma, applied after the dimmer. **Use `1` for `pixel-check.js`** |
| `--no-gpu` | do not open a renderer even if one is available |
| `--verbose`, `-v` | log every message instead of a one line status |

The flags mirror `mock/display.js`'s so the two are interchangeable.

Installed as a service, the arguments live in `/etc/default/limut-hub75` and `install.sh` will
not overwrite that file — the panel size is a property of the wall, not of this checkout.

## Shape of it

```
poll(listen, clients, timeout = time to the next 1Hz tick)
  1. drain every readable byte and dispatch it
       JSON control -> handle now (may compile a shader, may upload a texture)
       chunk 0x02   -> append to the single in-flight asset
       frame 0x01   -> stale seq discarded; otherwise overwrite the ONE pending slot,
                       counting the frame it displaced in stat.dropped
  2. if a frame is pending: render -> readback -> output stage
  3. once a second: stat, ping
```

One thread, the render inline, no queues. **Draining fully before drawing is what makes
last-write-wins free** (§12.1): a frame superseded before it was drawn is never queued, only
counted. If render and readback ever fall behind the host, the loop degrades by dropping frames,
which is the specified behaviour rather than a failure — `stat.renderMs` says when that starts.

| file | |
|---|---|
| `main.c` | arguments, the loop, the status line |
| `net.c` | listening socket, HTTP routes, the RFC 6455 upgrade, poll |
| `ws.c` | the minimum RFC 6455 the protocol needs — the C twin of `mock/ws-server.js` |
| `session.c` | the protocol state machine of §5–§12, and `/debug` |
| `cache.c` | content-addressed asset and program caches |
| `render.c` | EGL/GBM, program compile, lut upload, draw, readback — and the no-GPU stub |
| `glsl.c` | structural checks on a shader source, with no GL involved |
| `output.c` | dimmer, gamma, and the backend seam |
| `codec.c` `json.c` `sha1.c` `sha256.c` `base64.c` `patterns.c` | the small pieces |

Vendored rather than linked: SHA-1, SHA-256, base64 and the JSON parser. It keeps the build line
as short as `../tools/egl-probe.c`'s, and the JSON parser is 300 lines because the message set is
tiny and entirely flat except for `layer.textures`.

## If a browser cannot reach the display

Check **macOS Privacy & Security → Local Network** for that browser first, before anything here.
Without it the browser cannot reach any other device on the LAN, and limut reports
`CORS request did not succeed, status code (null)` — which is not a CORS problem. The tells: the
failure takes 1-2 ms rather than a round trip, and `mode: 'no-cors'` fails too, which no header
problem can cause. `localhost` and the machine's own LAN address keep working, because neither is
another device. Restart the browser after granting it.

**But a `.local` name that Chrome cannot resolve looks EXACTLY the same, and is the more likely
cause.** Chrome's own resolver does not do mDNS, so `hub75-01.local` resolves fine from Node,
`curl` and the shell and is unreachable from the page — failing in ~3 ms, and failing under
`mode: 'no-cors'` too, which is the same signature the Local Network denial gives. Diagnosed
wrongly here on 2026-09-04 for exactly that reason.

**The discriminator is one line: try the IP.** `ping hub75-01.local` for the address, then fetch
`http://<ip>:7575/info` from the same page.

| name | IP | |
|---|---|---|
| fails fast | fails fast | Local Network permission — grant it in System Settings, restart the browser |
| fails fast | **works** | mDNS. Nothing to grant; use the address |

`app-check.js` resolves the name with `dns.lookup` and hands the browser an address, so it works
with a `.local` argument or none at all. In the app itself, `display='hub75-01'` becomes
`hub75-01.local:7575` — if that cannot connect, put the IP in the `display` param instead.

## Five things worth knowing before touching it

**The connection table has to tolerate sockets that never send anything.** A browser opens
speculative connections it may never use — Firefox preconnects several per origin and holds them
open. The first version of this had eight slots, no idle timeout, and refused new connections
when full, so a handful of preconnects made the display permanently unreachable: *eight idle
sockets, and `/info` stops answering entirely*. From the browser that is indistinguishable from
the display being down, and it surfaces as `CORS request did not succeed, status code (null)` —
which sends you looking at headers. Now: 32 slots, connections that have not completed a request
reaped after 10 s, and a full table evicts the oldest non-session connection rather than refusing
the new one. The live session is never evicted. `app-check.js` holds 40 idle sockets and checks
the display still answers, because every other check here uses one connection at a time and would
never notice.

**The listening socket must be dual stack.** avahi publishes both an A and an AAAA record, so
`<name>.local` resolves to both and a browser is free to prefer either. An IPv4-only bind means
Firefox connects over IPv6, is refused, and reports
`CORS request did not succeed, status code (null)` — a message that points squarely at headers
when the actual problem is that nothing is listening. Chrome reaching IPv4 first is what hid it
through every check. One `AF_INET6` socket with `IPV6_V6ONLY` off serves both; the startup line
says which families are bound, so a regression is visible immediately.

**`ws_feed` must dispatch a message before consuming it from the buffer.** `payload` points into
the inbound buffer, and consuming shifts the remainder down over exactly that region — so
consuming first hands the callback a payload already overwritten by whatever followed it in the
same read. That only happens when two messages arrive together, which at 60 Hz is the normal
case and never happens in a test that feeds one frame at a time. `selftest.c` has a case for it.

**The structural shader checks in `glsl.c` run even though a real compiler is available.** A
driver compiles `uniform vec4 u_vs0;` happily whatever the announced list says, but the uniform
slot index is positional on the wire (§7.1) — so a declared list that disagrees with the source
is a silent wrong-picture bug, and only the text check catches it.

**Nothing that forks belongs on the 60 Hz loop.** `stat.throttled` originally came from
`vcgencmd get_throttled`, and that fork every ten seconds showed up as a 21 ms `renderMs` spike —
30× the normal frame. The same undervoltage signal is a plain sysfs read from the
`raspberrypi-hwmon` driver (`in0_lcrit_alarm`), latched here into vcgencmd's own bits. `renderMs`
max went from 21.70 to 0.67.

## Two HTTP routes that are not part of the protocol

Both exist for testing, and both are documented as outside protocol v1.

- **`GET /frame.raw`** — the last frame as it left the output stage, dimmer and gamma already
  applied: exactly what the panels would be showing. Raw RGBA8 with `X-Width`/`X-Height`, so
  there is no encoder here, no decoder in the test scripts, and a pixel comparison is exact.
- **`GET /debug`** — the internal state `mock/display.js` exposes to its test client as
  `main.display`, field for field. It is what lets `mock/selftest.js --endpoint` assert on a real
  display exactly as it does against the mock, instead of needing a second, weaker suite.

## Verifying it

```sh
make test                                                    # 78 unit checks, no GPU needed
node ../mock/selftest.js                                     # the mock still passes: 63
node ../mock/selftest.js --endpoint hub75-01.local:7575      # the same suite, this daemon: 64
node app-check.js hub75-01.local:7575                        # the real app, in a browser, driving it
node pixel-check.js hub75-01.local:7575                      # does it match the browser?
node perf.js hub75-01.local:7575 20                          # can it hold 60Hz?
node frame-png.js hub75-01.local:7575 frame.png 6            # look at what it is showing
```

`app-check.js` needs `sh server.sh` running, and is the only check that puts the real host and
the real display together: everything else covers one link. It asserts on what the *display*
observed, through `/debug` and `/frame.raw`.

`pixel-check.js` is the one that could not be written before this existed. `selftest.js` proves
the two ends agree about the *protocol*; it says nothing about whether Mesa v3d puts the same
colours in the same places as a browser's WebGL2. Every rule in §13 that could be got wrong — the
constant vertex shader, the fullscreen quad, the y-up `fragCoord`, the `sqrt` aspect softening,
`LINEAR`/`CLAMP_TO_EDGE`, the `u_vsex == (0,0)` rule for luts, the vertical flip on readback —
fails there and nowhere else, and fails as a picture that is subtly wrong rather than as an
error. It renders the same shader both sides and compares; **run the display with `--gamma 1`**
or every comparison is off by the gamma curve, and it refuses to run if you forget.

The daemon's panel size is fixed at startup, so `pixel-check.js` generates its fixtures at
whatever `/info` reports. Run it once at `128x64` and once at something wider than 2:1 to cover
both sides of the aspect softening branch.

## What is not here

**~~The Colorlight output stage.~~** Done, and driving the real wall since 2026-08-29 — the whole
six-module 64x192 display since 2026-09-04, at 60 fps with zero transmit drops. Panel mapping
turned out **not** to be the card's job: LEDVISION cannot express the modules' 90 degree mounting
rotation at all, so it is the `--panel ...:ROT` pixel permutation `output.h` reserved for exactly
this. Each rotation is a constant stride through the render, so no rotated intermediate buffer
exists anywhere.

**`kind:"image"` assets**, which are not implemented host side either — `assets.classify` refuses
them, so nothing can reach here from limut. The announce is rejected with a plain reason rather
than accepting bytes that would never be decoded. `stb_image.h` drops into `cache.c` when the
host gains it.

**PBO readback.** A synchronous `glReadPixels` costs 0.64 ms at 128x64, so pipelining a frame
behind would buy nothing and cost 16 ms of latency. Worth revisiting only if a much larger panel
makes it the bottleneck.

## Bringing up the panels

The order matters: each step needs only the ones before it, so a failure says where the problem
is rather than that there is one.

**1. Ask the card what it is.** Read-only — nothing is written to the card, whatever it prints.

```sh
gcc -O2 -o colorlight-probe ../tools/colorlight-probe.c
sudo ./colorlight-probe -i eth0          # -f for the whole reply, -t to wait longer
```

It reports link state first, because an unpowered card and a dead cable look exactly like a card
that is not answering. Then, for each receiver that replies: firmware, the cabinet geometry the
card is *currently configured for*, uptime and packet counts, over a hex dump of the raw reply.
**Believe the dump over the decode** — every offset in it comes from other people's reverse
engineering and none has been checked against a real card. See `../CLAUDE.md`.

The geometry it reports is the answer to "does this card need configuring with LEDVISION at all?"

**2. Drive the panels with no host.** No shader, no browser, no socket. The working invocation for
the card and panels in hand — see `../CLAUDE.md` for where every number comes from:

```sh
sudo ip link set dev eth0 txqueuelen 8000     # once; the systemd unit does this itself
sudo ./limut-hub75 --output colorlight --iface eth0 \
     --size 64x192 --canvas 1280x512 --trim-canvas --row-map 1 \
     --color-order bgr --brightness 100 \
     --panel 0,128:0,0:64x32:90  --panel 0,64:64,0:64x32:90  --panel 0,0:128,0:64x32:90 \
     --panel 32,128:0,32:64x32:90 --panel 32,64:64,32:64x32:90 --panel 32,0:128,32:64x32:90 \
     --test-pattern bars
```

That is the six-module 64x192 portrait wall as it actually runs — the same arguments
`/etc/default/limut-hub75` installs, plus a test pattern. **`--canvas 1280x512` is not a mistake
even though the card's cabinet is 192x64**: only the receiver window was reconfigured, not the
card's screen, and it will not latch a frame until a whole screen has gone out. `--trim-canvas`
then sends only the 192 columns the wall occupies, which is 514 packets a frame rather than 1538.
See `../CLAUDE.md` for how the panel map was read off the wall.

Two things that look like optimisations and are not: the whole canvas must be sent **every frame,
in canvas row order** (patching only what changed gives a black panel, and reordering the stream
gives horizontal glitching), and the transmit queue must be deepened or a third of each frame is
silently dropped. Both are in `../CLAUDE.md`.

On an unknown card, work up to that: `--test-pattern white` first (does anything light at all?),
then `bands` (do canvas rows superimpose, and how far apart?), then `map` (which cell is this
panel?). Each answers one question and none needs a measurement more precise than naming a colour.

Start dim. A wrong scan configuration drives rows for longer than intended, which is a heating
problem for the panels — not for the card, which cannot be harmed by anything here.

`bars` says whether colour and geometry are right; `grid` says whether panel boundaries and chain
order are. If the pixels are right but in the wrong places, the layout is the problem; if they are
noise, the card's configuration is.

**3. Then the real thing** — `node app-check.js`, the whole chain from the browser to the panels.

If step 2 does not produce a correct picture, `../CLAUDE.md` has the options for configuring the
card, including what to do without a Windows machine.
