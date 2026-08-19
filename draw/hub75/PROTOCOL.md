# limut ↔ HUB75 display protocol

Version **1**. Normative spec for the wire protocol between limut (the host, normally a browser)
and a HUB75 render node (the display, a Raspberry Pi 4B driving a Colorlight 5A-75B).

Keywords **MUST**, **SHOULD**, **MAY** are used in the usual sense.

## 1. What is being shipped, and why it is small

A limut visualsynth `px` chain compiles to a **completely self-contained** fragment shader.
`draw/visualsynth/codegen.js` `buildSource()` emits `#version 300 es` with no common processors,
no `preprocess`/`postprocess`, and none of the ~30 standard `l_*` uniforms that other limut
visuals use — against a generated program every one of those uniform locations resolves `null`.

So the entire shippable state of a visualsynth visual is:

- one fragment source string (typically 1–5 KB), against a **constant** vertex shader
- N uniforms, **all `vec4`**, named `u_vs0 … u_vsN-1`, order fixed when the shader is built
- M textures, `u_vstex0 … u_vstexM-1` (`sampler2D` or `sampler3D`), each with an extents
  companion `u_vsex0 … u_vsexM-1` (`vec2`)

Per frame that is `16 × N` bytes of uniform data. At N=8 and 60 Hz that is 8.6 kB/s. Bandwidth is
not a constraint anywhere in this design; framing, caching, error reporting and session lifecycle
are.

## 2. Host binding (limut side)

A visualsynth player gains a `display` param:

```
v1 visualsynth px=tex3d{{x,y,z}->{r:x,g:y,b:z}}, display='hub75-01'
```

When `display` is set, that player's output goes to the named panel **instead of** the main limut
canvas. Players without `display` are unaffected and keep drawing locally. Several players MAY
name different displays; in version 1 a display accepts **one** player (see §7). A companion `dim`
param carries the global dimmer (§9), evaluated per frame like any other limut param.

Implemented in `draw/hub75/host/`; see `CLAUDE.md` in this folder.

## 3. Transport

One TCP connection on one port. Default port **7575**.

The display MUST serve, on that port:

| request | response |
|---|---|
| `GET /info` | JSON identity/capabilities (§4), `Content-Type: application/json` |
| `GET /session` with `Upgrade: websocket` | RFC 6455 handshake, then a session (§5) |

WebSocket is used because it is the only bidirectional binary transport a plain browser has. To
keep the display-side implementation small (it will eventually be C on the Pi), version 1
constrains WebSocket usage to a minimal subset:

- text and binary frames only
- the display MUST NOT negotiate any extension, in particular `permessage-deflate`
- neither side sends continuation frames; every message is a single unfragmented frame
- every message MUST be ≤ 60 KB, so no reassembly logic is required anywhere
- client→server frames are masked (browsers always mask; this is not optional in RFC 6455)
- `ping`/`pong` are used for liveness; the display SHOULD ping an idle client every 5 s

### 3.1 Scheme constraint

`ws://` is correct for this protocol. limut is served over `http://localhost:8000`, so there is no
mixed-content restriction. **If limut is ever served over `https://`, browsers will refuse
`ws://`** and this protocol becomes unreachable from the browser without adding TLS to the
display. Recorded here because it is a silent, total failure if it happens.

### 3.2 USB

The protocol is transport-agnostic above TCP. Running the Pi's USB-C port in gadget mode
(`dtoverlay=dwc2` with the `g_ether`/NCM function) makes the Pi appear as an ordinary network
interface on the host machine, over which this protocol runs **unchanged** — same discovery, same
port, same messages. No protocol accommodation is needed. Pi-side configuration is not yet done.

## 4. Discovery

The display SHOULD advertise itself over mDNS as `_limut-hub75._tcp` on its port, with TXT
records `proto`, `name`, `w`, `h`. On the Pi that is a static
`/etc/avahi/services/limut-hub75.service`.

A browser cannot browse mDNS, but the operating system resolves `<name>.local`. So the host's
lookup of `display='hub75-01'` is:

1. treat the string as an explicit `host[:port]` if it contains `:` or a `.` (so
   `'hub75-01.local'`, `'10.0.0.7:7575'` and `'hub75-01'` all work)
2. otherwise resolve `<name>.local` on the default port
3. `GET http://<host>:<port>/info`
4. check `proto`, then open the session

`/info` MUST include `Access-Control-Allow-Origin: *`. Without it the browser's probe fails with
an opaque CORS error and discovery appears broken for no visible reason.

`/info` body:

```json
{
  "proto": 1,
  "name": "hub75-01",
  "display": { "w": 128, "h": 64 },
  "gl": { "version": "OpenGL ES 3.1 Mesa 26.2.0", "renderer": "V3D 4.2.14.0", "maxTextureSize": 4096 },
  "busy": false
}
```

Enumerating every display on the network ("show me what's out there") needs real mDNS browsing and
therefore a Node or Electron helper process. Not part of version 1; the host works from names.

## 5. Session

### 5.1 Handshake

Client opens `/session` and sends `hello`. The display replies `welcome` or `closed`.

```json
{ "type": "hello", "proto": 1, "client": "limut", "name": "steve's laptop", "takeover": true }
```

```json
{ "type": "welcome", "proto": 1, "session": "s3", "name": "hub75-01",
  "display": { "w": 128, "h": 64 },
  "gl": { "version": "...", "renderer": "...", "maxTextureSize": 4096 } }
```

- A client MUST send `hello` first. Any other message before `hello` is a protocol error.
- If `proto` does not match, the display replies `closed` with `reason: "proto"` and closes.
- **Takeover**: a display holds one session at a time. A `hello` with `takeover: true` displaces
  the existing session — the old client receives `{"type":"closed","reason":"takeover"}` and the
  socket is closed. With `takeover: false` (or absent), a second client is refused with
  `reason: "busy"`. Takeover is the norm for limut: a browser reload must never lock itself out.
- Caches (§6, §7) are **not** cleared by a session change. They are content-addressed, so they
  stay valid and make reconnection cheap.

### 5.2 Message discriminator

Text frames are JSON objects with a `type` field, matching the convention already used by
`collaboration.js` in limut. Unknown `type` values MUST be ignored (forward compatibility), except
before `hello`.

### 5.3 Client → display

| message | meaning |
|---|---|
| `hello` | §5.1 |
| `have` | `{ "type":"have", "ids":[...] }` — which of these content ids are already cached? |
| `asset` | announce a texture, followed by its binary chunks (§6) |
| `prog` | shader program definition (§7.1) |
| `layer` | bind a program and its textures to the visible layer (§7.2) |
| `unlayer` | `{ "type":"unlayer", "id":0 }` — blank the layer |
| `dim` | `{ "type":"dim", "v":0.5 }` — set the dimmer outside the frame stream (§9) |
| `test` | `{ "type":"test", "pattern":"bars"\|"grid"\|"off" }` — bring-up diagnostics (§10) |
| `bye` | clean close |

### 5.4 Display → client

| message | meaning |
|---|---|
| `welcome` | §5.1 |
| `have` | `{ "type":"have", "missing":[...] }` — reply to `have` |
| `assetok` | `{ "type":"assetok", "id":"..." }` |
| `progok` | `{ "type":"progok", "id":"..." }` |
| `error` | §8 |
| `stat` | §11 |
| `closed` | `{ "type":"closed", "reason":"takeover"\|"busy"\|"proto"\|"bye" }` |

## 6. Assets (textures)

Textures are **content-addressed**: `id` is the lowercase hex SHA-256 of the asset bytes, truncated
to 16 characters. The display keeps a cache keyed by `id`, so an asset is uploaded at most once
per display regardless of reconnects or program changes.

Only three texture sources are reachable from a `px` chain (`draw/visualsynth/nodes.js`):

| source | wire `kind` | notes |
|---|---|---|
| `tex1d` / `tex2d` / `tex3d` | `lut` | raw RGBA8 bytes, already produced as a `Uint8Array` by `sampleLut()`. Static once built — timevars and sliders inside the expression are frozen at build time. Default sizes: 1d 256×1 = 1 KB, 2d 64² = 16 KB, 3d 16³ = 16 KB |
| `tex{'url'}` | `image` | the **original encoded file bytes** (PNG/JPEG), not decoded pixels — a 1024² image is 4 MB raw but usually well under 1 MB encoded. The display decodes it (e.g. `stb_image.h`). Sending encoded bytes also sidesteps canvas tainting on the host |
| `tex{webcam{}}` | — | **not supported in version 1.** Inherently a local capture device. The host MUST warn and refuse to bind a layer whose chain contains a webcam texture |

### 6.1 Announce

```json
{ "type":"asset", "id":"3f9a1c2b7d4e5061", "kind":"lut",
  "dims":3, "size":16, "bytes":16384, "chunks":1 }
```

- `kind:"lut"` — `dims` is 1, 2 or 3 and `size` is the per-axis size. Byte layout is RGBA8 with
  **x varying fastest, then y, then z**, which is the layout `texImage2D`/`texImage3D` expect. A 1d
  lut is uploaded as a `size × 1` 2D texture (there are no 1D textures in GLES); a 3d lut uses
  `TEXTURE_3D` with internal format `RGBA8`.
- `kind:"image"` — `dims`/`size` are absent; the display learns the dimensions by decoding.
- `bytes` is the total asset size, `chunks` is `ceil(bytes / 16384)`.

### 6.2 Chunks

Immediately after the announce, the client sends `chunks` binary frames (§12.2) carrying 16 KB
payloads in order. Exactly **one asset may be in flight at a time**, which is why a chunk carries
only its index and no asset id.

Chunks MAY be interleaved with frame packets, and the host SHOULD interleave them: the point of
chunking is that a 1 MB image cannot stall the uniform stream behind it.

When the last chunk arrives the display verifies the SHA-256 of the reassembly against `id`, then
replies `assetok`, or `error` with `kind:"asset"` on a mismatch, a size mismatch, an out-of-order
chunk, or a decode failure. For a `lut` it also checks that the byte count agrees with `dims` and
`size` — a lut uploaded with the wrong stride shows as garbage rather than as an error, so it is
worth catching on the wire.

Assets are referenced by layers (§7.2), never by programs.

## 7. Programs and layers

### 7.1 Program

A program is **just the compiled shader**. It carries no texture bindings — see §7.2 for why.

```json
{ "type":"prog", "id":"9c4e...", "frag":"#version 300 es\n...",
  "uniforms":["u_vs0","u_vs1"] }
```

- `id` is the SHA-256 (16 hex chars) of `frag`. This is the wire-level equivalent of
  `draw/visualsynth.js`'s `programs[fragSource]` cache and gives the display a program cache that
  survives reconnects.
- `frag` is sent **inline** rather than through the asset path: it is text, it is small, and
  keeping it in the JSON message means compile errors can name it directly.
- `uniforms` is the ordered list of uniform names. Position in this array is the **uniform slot
  index** used by frame packets (§12.1). All are `vec4`. The list is a pure function of the
  source, so a program re-sent with a different list is an error, not an update.
- A `prog` whose `id` is already cached is acknowledged with `progok` without recompiling. A
  program that previously failed to compile stays failed; the display MUST NOT recompile it.

The display replies `progok` on success, or `error` with `kind:"compile"` or `kind:"link"`
carrying the driver info log (§8).

### 7.2 Layer

```json
{ "type":"layer", "id":0, "prog":"9c4e...",
  "textures":[ {"unit":0, "sampler":"sampler2D", "asset":"3f9a1c2b7d4e5061"} ] }
```

Binds a compiled program **and the textures it samples** to a visible layer. Idempotent —
re-sending an identical `layer` is a no-op, and a `layer` naming a different program or different
textures hot-swaps at the next frame.

**Textures bind to the layer, not to the program.** This is not arbitrary. The program id is the
hash of the shader source, and a lut's *contents do not appear in the source* — only its size does
(`draw/visualsynth/nodes.js` bakes `size` into `lookupExpr` as a literal and nothing else).
So `tex1d{{x}->x}` and `tex1d{{x}->1-x}` generate **byte-identical GLSL** and therefore share a
program id, while needing completely different texture data. If textures hung off the program, the
second chain would silently render with the first one's lut. Binding them to the layer also
matches GL itself, where a program object and its sampler bindings are separate state.

- `textures[i].unit` is the texture unit; it matches the `u_vstex<unit>` and `u_vsex<unit>` names
  in the source. Units MUST be dense from 0.
- Every referenced `asset` MUST already be cached, or the display replies `error` with
  `kind:"asset"` and leaves the layer unchanged.
- The number and sampler types of the bound textures MUST match the sampler declarations in the
  program's source. A mismatch is a protocol error: it means the two ends disagree about what the
  shader is.
- A `layer` naming a program that was never sent is a **protocol error** and closes the session.
  Delivery is ordered, so this cannot be a race — the `prog` message would have arrived first. It
  is a host bug, and failing loudly beats showing a wrong picture.

**Version 1 supports exactly one layer, `id: 0`.** A `layer` with any other id is a protocol
error. The frame packet nonetheless carries a layer count so multiple composited layers can be
added later without a framing change.

**Layer lifetime is per player, not per event.** limut's visualsynth renders once per *event*, but
a display-bound player holds its layer open from the moment it is defined until it is removed. The
wall shows continuous output; animation comes from the uniform stream, not from layers opening and
closing. `unlayer` blanks the layer to black.

## 8. Errors

```json
{ "type":"error", "kind":"compile", "id":"9c4e...", "log":"0:14: 'foo' : no matching overload" }
```

| `kind` | meaning | display behaviour | host behaviour |
|---|---|---|---|
| `compile` | fragment shader failed to compile | keep rendering the previous program | **permanent** for that `id`: never resend it. Mirrors `draw/visualsynth.js` setting `programs[src] = null` |
| `link` | program failed to link | keep rendering the previous program | permanent for that `id` |
| `asset` | hash/size mismatch, bad chunk order, decode failure, or a `layer` referencing an uncached asset | drop the partial asset, leave the layer unchanged | transient: MAY retry the upload |
| `render` | GL error, incomplete framebuffer, output stage failure | blank or hold last frame | transient; surface to the user |
| `protocol` | malformed message, message before `hello`, bad layer id | send `error` then close | reconnect with backoff |

The host surfaces these through `consoleOut`, matching limut's existing convention — e.g.
`🔴 hub75 hub75-01: shader compile error: ...`, alongside the existing
`🔴 Visual synth shader error:`.

**Reconnection**: exponential backoff from 250 ms to 5 s. On reconnect the host sends `hello`,
then `have` with the ids it believes are cached, then re-sends only what is missing, then `prog`
and `layer`. Content addressing makes this close to free.

## 9. Global dimmer

A single display-wide brightness multiplier, `0.0` … `1.0`, default `1.0`.

It is carried as a `f32` in **every frame packet** (§12.1) rather than as its own message. That
costs 4 bytes, needs no change detection on the host, and — because on the host it is just another
limut expression — means `dim=[0:1]l` fades the whole wall as a timevar.

The `dim` **message** (§5.3) exists for the case where no frames are flowing (no layer bound, host
paused, bring-up test pattern). Both paths set the same value; the most recent one wins.

Semantics: a linear multiply applied to the rendered RGB **before** gamma / PWM encoding in the
output stage. It therefore works even when the shader is broken, no layer is bound, or a test
pattern is showing. Values outside `0..1` are clamped. The value is held across frames and across
sessions; it is display state, not session state.

## 10. Test patterns

`{ "type":"test", "pattern":"bars" }` shows a built-in pattern instead of the layer, for bring-up
before any shader exists: `bars` (colour bars), `grid` (one-pixel grid, for panel mapping), `off`
(return to normal rendering). The dimmer applies. Patterns are generated entirely by the display.

## 11. Telemetry

About once per second the display sends:

```json
{ "type":"stat", "fps":59.9, "rendered":3591, "dropped":4, "renderMs":2.1,
  "seq":3595, "temp":52.1, "throttled":0 }
```

`dropped` counts frame packets superseded before they were drawn (§12.1). `throttled` mirrors
`vcgencmd get_throttled`; a non-zero value here is the undervoltage/thermal signal that cost most
of the Pi's first bring-up, so it is worth carrying.

## 12. Binary packets

All multi-byte fields are **little-endian**. Byte 0 is the packet type.

### 12.1 Frame packet — `0x01`

Sent once per host animation frame (~60 Hz), whether or not anything is drawing.

```
off  size  field       type   notes
0    1     packetType  u8     0x01
1    1     layerCount  u8     0 or 1 in version 1
2    2     flags       u16    reserved, MUST be 0
4    4     seq         u32    monotonic, wraps
8    4     dim         f32    global dimmer, 0..1 (§9)
12   4     beat        f32    metronome.beatTime(now)
16   8     hostTime    f64    system.timeNow(), the audio clock, seconds
24   ...   layers      —      layerCount repetitions of:
       2     layerId       u16
       2     uniformCount  u16
       16×uniformCount     f32   uniform values, 4 per uniform, in prog.uniforms order
```

Total `24 + layerCount × (4 + 16 × uniformCount)` bytes. A single layer with 4 uniforms is 92
bytes.

- **`layerCount: 0` is legal** and is what the host sends when nothing is drawing. This keeps one
  code path on both sides and keeps `dim`, `beat` and `hostTime` live with no content bound.
- `uniformCount` MUST equal the length of the bound program's `uniforms` array. A mismatch is a
  protocol error — it means the two ends disagree about which program is bound.
- **Last-write-wins.** If a newer frame packet arrives before the previous one has been drawn, the
  display MUST discard the older one and count it in `stat.dropped`. On a live wall staleness is
  worse than loss. This is the same decoupling `draw/dmx-worker.js` already does for DMX output.
- A packet whose `seq` is older than the last one processed MUST be discarded (reordering after a
  reconnect).
- **Backpressure**: the host MUST skip sending a frame when the socket's `bufferedAmount` exceeds
  128 KB, rather than queueing it. Queued uniform frames are stale by definition.

### 12.2 Asset chunk — `0x02`

```
off  size  field       type   notes
0    1     packetType  u8     0x02
1    1     reserved    u8     MUST be 0
2    2     chunkIndex  u16    0-based, ascending, no gaps
4    ...   payload     —      ≤ 16384 bytes; only the last chunk may be short
```

No asset id: exactly one asset is in flight at a time (§6.2).

## 13. Rendering contract

The display MUST reproduce limut's rendering conventions, or output will not match what the same
`px` chain shows in the browser.

**Vertex shader** — constant, byte-for-byte the `common.vtxShader` from `draw/shadercommon.js`:

```glsl
#version 300 es
in vec2 posIn;
in vec2 fragCoordIn;
out vec2 fragCoord;
void main() { gl_Position = vec4(posIn, 0, 1); fragCoord = fragCoordIn; }
```

**Geometry** — a fullscreen quad, two triangles, 6 vertices, `drawArrays(GL_TRIANGLES, 0, 6)`.
`posIn` covers NDC `[-1,1]²`.

**Coordinates** — `fragCoord` spans `[-har, +har]` horizontally and `[-ihar, +ihar]` vertically,
**y-up** (`+ihar` at the top of the panel). With `har = panelWidth / panelHeight`:

```
ihar = 1
if (har > 2 || har < 1/2) { har = sqrt(har); ihar = 1/har }
```

This softening is from `verts()` in `draw/sprite.js` and matters more here than in a browser
window: a HUB75 wall is easily 4:1 or wider, and without it the image is unusably stretched.

**Textures** — `LINEAR` filtering, `CLAMP_TO_EDGE` wrapping on every axis, matching
`draw/sprite.js`. LUT assets are `RGBA8`; image assets are decoded to `RGBA8`.

**Extents** — `u_vsex<unit>` is set by the display from the texture's own dimensions and is **not**
on the wire. For a `lut` asset it MUST be left at `(0,0)`: `lut.js` deliberately gives lut textures
no `width`/`height` so no aspect correction is applied, and the `tex` node's generated code guards
on `u_vsex.y > 0.0`.

**Framebuffer** — render at exactly the panel resolution. Clear to opaque black. No blending in
version 1 (single layer over black). Colour output is RGBA8; the dimmer and gamma are applied by
the output stage after readback.

## 14. Versioning

`proto` is a single integer, exchanged in `/info` and in `hello`/`welcome`, and mismatches close
the session. Additive changes that unknown-message-ignoring clients tolerate (new message types,
new JSON fields) do not bump it. Changes to binary layouts, or to the meaning of existing fields,
do.

Room already reserved in version 1: `layerCount` and per-layer `layerId` in the frame packet, and
the `flags` word — multi-layer compositing with z-order and blend modes can be added without a
framing change.

## 15. Implementations

`draw/hub75/mock/` is a zero-dependency Node implementation of the **display** side, including a
hand-rolled RFC 6455 server. It exists so the limut host side can be built and tested before the
Colorlight card and panels arrive, and it doubles as a demonstration that the display side needs
only a small subset of WebSocket. See `draw/hub75/mock/README.md`.

`draw/hub75/host/` is the **host** side, in limut itself. `draw/hub75/mock/host-check.js` drives it
in a real browser against the mock and asserts on what the display observed.

`draw/hub75/pi/` is the **real display**: a C daemon for the Raspberry Pi that serves this
protocol and renders on the GPU. `mock/selftest.js --endpoint host:port` runs the same
conformance suite against it that it runs against the mock.

`draw/hub75/codec.js` is the binary packet codec of §12, shared by the host and the mock: dual
AMD/CommonJS so the byte layout lives in exactly one place. `pi/codec.c` restates it in C, and
`pi/selftest.c` pins that restatement against the numbers in §12 rather than against `codec.js`.

Two HTTP routes on the Pi daemon are **outside this protocol** and exist only for testing:
`GET /frame.raw` returns the last frame as it left the output stage (dimmer and gamma applied)
as raw RGBA8 with `X-Width`/`X-Height` headers, and `GET /debug` returns the display's internal
state as JSON. Neither is required of a conforming display.

Not yet implemented anywhere: `kind:"image"` assets, at either end. The Colorlight output stage
below the Pi renderer is also outstanding, but that is below this protocol, not part of it.
