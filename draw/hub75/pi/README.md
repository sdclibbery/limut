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

**The Colorlight output stage.** `output_colorlight.c` implements the interface and sends
nothing; the 5A-75B and the panels are not in hand. Everything upstream of it is finished and
verifiable with `--output raw`. The systemd unit already grants `CAP_NET_RAW`, and `eth0` is
meant to be left unmanaged with no IP — the card takes raw broadcast frames, so the link just
needs to be up. Panel *mapping* is expected to be the card's own flashed configuration rather
than anything here, so the Pi sends a rectangular image; if bring-up shows the card cannot
express the layout, mapping becomes a pixel permutation in `output.c`.

**`kind:"image"` assets**, which are not implemented host side either — `assets.classify` refuses
them, so nothing can reach here from limut. The announce is rejected with a plain reason rather
than accepting bytes that would never be decoded. `stb_image.h` drops into `cache.c` when the
host gains it.

**PBO readback.** A synchronous `glReadPixels` costs 0.64 ms at 128x64, so pipelining a frame
behind would buy nothing and cost 16 ms of latency. Worth revisiting only if a much larger panel
makes it the bottleneck.
