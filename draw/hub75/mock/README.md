# Mock HUB75 display

A fake display that speaks the limut display protocol (`../PROTOCOL.md`), so the limut host side
can be built and tested before the Colorlight card and the panels arrive.

It implements everything the real Pi renderer must implement **except** the two parts that need
hardware: actually rendering the shader, and pushing pixels to the receiving card. Discovery, the
session lifecycle, the asset and program caches, error reporting, the dimmer, frame pacing and
drop accounting are all real.

```sh
node draw/hub75/mock/display.js --name hub75-01 --size 128x64
node draw/hub75/mock/selftest.js          # 63 assertions over every protocol path
```

## Zero dependencies, on purpose

`ws-server.js` is a hand-rolled RFC 6455 server in ~180 lines of `node:http` and `node:crypto`.
Using the `ws` package would have been quicker, but this way the repo keeps its single npm
dependency (Electron), and — more usefully — the file is a working statement of **how much
WebSocket the Pi renderer actually has to implement in C**. The protocol is deliberately
constrained (no extensions, no fragmentation, nothing over 60 KB) so the answer stays small.

The selftest drives it with Node's *built-in* `WebSocket` client, which is the same standards
implementation a browser uses — so the tests exercise the hand-rolled server against a real
client rather than against a matching hand-rolled one.

## Files

| file | what it is |
|---|---|
| `ws-server.js` | minimal RFC 6455 server: handshake, unmasking, text/binary/ping/close |
| `codec.js` | binary frame and chunk encode/decode (`PROTOCOL.md` §12). Dual AMD/CommonJS, so the limut host side can require the same file rather than keeping a second copy of the byte layout |
| `display.js` | the display: `/info`, `/session`, session state machine, caches, error paths, dimmer, 60Hz consume-and-drop |
| `selftest.js` | scripted client covering every path, including the ones that only happen when something is wrong |

## Flags

| flag | |
|---|---|
| `--port N` | listen port (default 7575) |
| `--name NAME` | display name in `/info` and `welcome` (default `hub75-01`) |
| `--size WxH` | panel resolution (default 128x64) |
| `--fail-compile STR` | reject any shader whose source contains `STR`. For exercising the host's compile-error handling — it must surface the log and never resend that program |
| `--drop PCT` | randomly discard `PCT`% of frame packets. The display must stay up and account for them in `stat` |
| `--verbose`, `-v` | log every message instead of a one-line status |

## Shader checking

If `glslangValidator` is on `PATH` the mock really compiles the shader and returns the real error
log. Otherwise it falls back to structural checks, which are the ones worth having anyway: the
`#version 300 es` preamble, `fragCoord` in and `fragColor` out, and — most valuable — that the
declared `uniforms` list matches the `uniform vec4 u_vsN` declarations in the source. Uniform slot
index is positional on the wire, so a list that disagrees with the source is a silent
wrong-picture bug rather than a crash.

To get real compilation on macOS: `brew install glslang`.

## Checking it from a browser

The one thing a Node-only test cannot prove is that the hand-rolled handshake satisfies a real
browser. With the mock running, in any page's devtools console:

```js
let s = new WebSocket('ws://localhost:7575/session')
s.onmessage = e => console.log(e.data)
s.onopen = () => s.send(JSON.stringify({type:'hello', proto:1, client:'devtools', takeover:true}))
```

A `welcome` message back means the browser transport works end to end.

## What it does not do

- **No rendering.** `display.tick()` consumes at most one frame packet per 60Hz tick and counts
  the rest as dropped, which is what makes the drop accounting meaningful, but nothing is drawn.
- **No mDNS advertisement.** On the dev machine the mock is reached at `localhost`; the real Pi
  will advertise `_limut-hub75._tcp` through avahi (`PROTOCOL.md` §4).
- **No Colorlight output**, and therefore no gamma curve. The dimmer is tracked but only applied
  in principle.
