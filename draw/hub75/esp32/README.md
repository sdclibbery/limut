# ESP32-S3 display node — feasibility analysis

**Status: analysis only, nothing built.** Written 2026-08-26. Nothing in this folder is on the
build path for anything; it is a record of a question asked and the answer arrived at, so that the
work does not have to be redone from scratch if it is picked up later.

## The question

The render node in this project is a Raspberry Pi 4B running the shader on its V3D GPU (`../pi/`).
Could an **ESP32-S3** be a lightweight alternative render node, outputting to a relatively small
number of **addressable LEDs** instead of HUB75 panels?

Three sub-questions, answered in order below: can it run a GLES shader; what would the software
stack be; how many LEDs could it drive.

---

## 1. Can an ESP32-S3 run a GLES shader?

**No, and there is no path to one.**

- The ESP32-S3 has no GPU. It is a dual-core 240 MHz Xtensa LX7 with a single-precision FPU per
  core and a 128-bit *integer* SIMD extension (PIE). There is no programmable shader core, no GLES
  driver and no GLSL compiler for the part.
- The only Espressif chip with graphics hardware is the ESP32-P4, whose PPA is a 2D blitter/blender
  — fills and blends, not programmable shading. It would not help.
- A software GL stack (Mesa `llvmpipe`, SwiftShader) needs an MMU-class OS and tens of megabytes.
  Out.

So the shader's *API* is unavailable. What is available is the shader's *semantics*: evaluate the
same per-pixel function in software. Whether that is practical turns entirely on how regular our
generated GLSL is — and it turns out to be very regular indeed.

### Why our generated GLSL is unusually tractable

`buildSource()` in `draw/visualsynth/codegen.js:90` emits a completely self-contained shader: no
prelude, no `#define`s, no `preprocess`/`postprocess`, none of the ~30 standard `l_*` uniforms. Real
examples in `../pi/pixel-check.js:73` are 250–400 bytes; PROTOCOL.md §1 says 1–5 KB typical. The
whole grammar is:

- one `main()`, plus optional `l_*` helper functions declared before it
- a straight-line list of `vec4 vN = <expr>;` — SSA, from a deterministic counter
- everything is `vec4`, apart from a couple of `vec2` locals in the tex node's preamble
- `for` loops with literal bounds (`shader-repeat.js`) and `if` blocks (`shader-branch.js`);
  ternaries are already lowered to `mix` before they reach GLSL
- swizzles, arithmetic operators, and a **small builtin set**

Counting the builtins actually emitted across `draw/visualsynth/*.js`:

```
vec4 vec3 vec2 mix clamp texture floor float sin log pow fract atan round max dot
smoothstep cross sign normalize min length tanh tan sqrt exp cos ceil abs
```

About 28. That is a language you can write a compiler for in a few hundred lines of C, *precisely
because it is machine-generated and never hand-written*.

---

## 2. Recommended architecture

**An on-device GLSL-subset compiler feeding a `vec4` bytecode VM, evaluated once per LED.**

```
limut (browser)  ──ws://leds-01.local:7575──▶  ESP32-S3
   prog: GLSL text (once, SHA-256 addressed)      compile → bytecode  (once per shader)
   frame packet 0x01: N × vec4 @ 60 Hz            per LED: seed v0 from coord table, run VM
                                                  → dimmer → gamma → DMA to strips
```

The device stays a **conforming protocol v1 display** and nothing in limut changes. `display` is a
free-form string handed straight to `resolveEndpoint()` (`../host/session.js:24`), and the host is
entirely geometry-blind — `w`/`h` from `/info` reach nothing but a console log line and
`hub75 status`. `display='leds-01'` would simply work.

That also means **`../mock/selftest.js --endpoint leds-01.local:7575` is the conformance suite on
day one**, with no new test code. The same 63 assertions that pin the mock and the Pi daemon.

### Why not a host-side bytecode backend

Tempting — compile the px chain to bytecode in the browser and ship that instead of GLSL — but
rejected. Visual nodes emit **GLSL text**, not an expression tree:

```js
ctx.addStatement(`${input} * ${ctx.addUniform(ast)}`)
```

So a second backend means rewriting all ~2,700 lines of `draw/visualsynth/*.js`, plus a format
negotiation field in the protocol. All of the cost, and it throws away the drop-in property.
On-device parsing keeps the host completely untouched.

### The failure mode is already designed for

An unsupported construct becomes `error kind:"compile"`, which PROTOCOL.md §8 already defines as
**permanent for that source hash** and reports back with a log string. A px chain the ESP32 cannot
handle surfaces as a clear error in limut, not as a wrong picture. That is a forgiving place to be
starting from, and it means the compiler can be built up incrementally — support a subset, reject
the rest loudly, widen it over time.

### Geometry: LEDs are a *better* fit than panels

The Pi renders a `w × h` raster and reads it back, and the intended home for any odd physical
layout is "a pixel permutation applied here, before framing" (`../pi/output_colorlight.c`'s header
comment).

**On the ESP32, skip the raster entirely.** Keep a per-LED coordinate table (`led[i] → vec2` or
`vec3`) and seed `v0 = vec4(coord, 0.0, 1.0)` per LED. Consequences, all good:

- You evaluate exactly N pixels, not W×H. 500 LEDs is 500 evaluations against the Pi's 8,192 at
  128×64 — **16× less work for a display of comparable physical presence.** This is the single
  biggest reason the idea is practical at all.
- Arbitrary layouts are native: rings, spirals, cubes, a scattered costume. No permutation stage,
  no `output_colorlight.c` equivalent needed.
- A **3D** coordinate table makes px chains volumetric for free — `px=length<1/2 ?? #f00 ?: #00f`
  becomes a sphere. The HUB75 path cannot do that.
- The aspect softening in `../pi/render.c:89` is irrelevant here and should be dropped. The
  coordinate table is authored in whatever space you want.

Table delivery: for v1, flash it at provision time (`--map`), exactly as the Pi treats `--size` —
"the panel size is a property of the wall, not of this checkout". A `map` message over the socket is
an additive extension §14 permits without a proto bump, if it ever needs to be live.

---

## 3. Software stack

```
ESP-IDF v5.x  (not Arduino — needs core pinning, IRAM placement, DMA control)

core 0 — protocol task
  TCP listener :7575, HTTP /info (+CORS) and /session RFC6455 upgrade   ← port pi/net.c, pi/ws.c
  JSON                                                                  ← port pi/json.c
  SHA-256 / SHA-1 / base64                                              ← mbedTLS (S3 has HW SHA)
  protocol state machine                                                ← port pi/session.c
  content-addressed asset cache, ~2–4 MB in PSRAM                       ← port pi/cache.c
  frame packet 0x01 / chunk 0x02 decode                                 ← port pi/codec.c verbatim

shader compiler — runs once per `prog`                                  ← NEW, ~800–1200 lines
  tokenizer → statement parser over the subset above → register-allocated bytecode
  anything outside the subset → error kind:"compile"

core 1 — render task                                                    ← NEW, ~400 lines
  per LED: seed v0 from coord table, run bytecode, write RGB
  vec4 float32 register file, ~40 opcodes, computed-goto dispatch, all in IRAM
  LUT-approximated sin/cos/pow/log/exp/atan
  dimmer (linear, pre-gamma) + 256-entry gamma LUT                      ← port pi/output.c

LED output                                                              ← NEW, ~200 lines
  WS2812 via FastLED parallel I2S (up to 24 lanes on S3), DMA double-buffered
  or APA102/SK9822 on SPI+DMA — preferable: no strict timing, so no jitter from the WiFi task
```

**Most of the Pi daemon ports unchanged.** `codec.c`, `json.c`, `cache.c`, `ws.c`, `net.c`,
`output.c`'s dimmer/gamma and `patterns.c` are plain C99 whose only OS dependency is BSD sockets,
which lwIP provides. Call it **60–70% of the daemon already written, and already conformance-tested**.
The genuinely new code is the compiler, the VM and the LED backend.

Two constraints inherited from `../pi/` worth re-tuning rather than copying: the asset cache budget
(64 MB on the Pi; 2–4 MB of PSRAM here) and `WS_MAX_MESSAGE` (60 KB, the protocol cap, and the
largest single buffer on the device — consider refusing `prog.frag` over ~16 KB, since real shaders
are 1–5 KB, and halve it).

---

## 4. How many LEDs, realistically

Five separate ceilings. **Only one of them is compute, and it is the binding one.**

### The compute ceiling

The best empirical anchor available is **Pixelblaze V3** — a mature ESP32 product running an
interpreted per-pixel expression language, which sustains **~48,000 pixel-evaluations per second**
and drives up to 5,000 pixels. The S3's LX7 has an FPU on both cores and is worth maybe 1.5–2× per
core; our chains are `vec4` throughout, so each statement costs ~4 lanes but does more. Netting
those out, expect the same order of magnitude: **40,000–120,000 pixel-evals/sec** for a well-written
VM.

At 60k px/s mid-estimate:

| px chain | LEDs @ 60 fps | LEDs @ 30 fps |
|---|---|---|
| short — `px=sin*#0f0`, `px=floor{1/8}+1/2` (~10 statements) | 1,500–2,500 | 3,000–5,000 |
| typical — ~30 statements, a texture lookup, one or two `sin` | 500–1,000 | 1,000–2,000 |
| heavy — `lib/sdf.limut` chains, `loop{}` with 8 iterations | 100–300 | 200–600 |

**Design around 500–1,000 LEDs at 60 fps for a typical chain.** That is a ring, a hoop, a costume, a
small 32×16 matrix, a few long strips — not a wall. The heavy row is real: the Pi's own perf run
used an 8-iteration per-pixel shader, and a loop multiplies body cost by its count identically here.

### The four non-binding ceilings

| ceiling | number | binding? |
|---|---|---|
| LED wire | WS2812 is 30 µs/LED/lane; 24 parallel I2S lanes × 550 = **13,200 LEDs @ 60 fps** | no |
| Memory | 2,000 LEDs × 3 B = 6 KB; coord table 24 KB; registers 1 KB. S3 has 512 KB SRAM | no |
| WiFi | one frame packet is `24 + 4 + 16N` bytes — 92 B at N=4, ~6 kB/s at 60 Hz | no, by ~4 orders |
| **Power** | 1,000 WS2812 at a realistic 30% duty ≈ **18 A at 5 V ≈ 90 W**, injection every ~150 LEDs | **often yes, in the room** |

Get a module with PSRAM (N16R8) for the lut cache.

Power deserves the same seriousness this project already learned to give it on the Pi (see the
undervoltage section in `../CLAUDE.md`). At these LED counts it bites well before the MCU does.

---

## 5. Fidelity and pacing

- **Precision.** `highp float` on the Pi vs float32 on the S3 is a non-issue. Start in float32 — the
  S3 has a real FPU. Fixed-point Q16.16 is the optimisation path, and PIE's 128-bit vector register
  is exactly 4 × int32 = one `vec4`, a suspiciously good fit worth perhaps 3–4×. But PIE has no
  float and is inline-asm only, so it is a later move, never a v1.
- **Transcendentals are where the performance is.** `sinf` is ~300 cycles; a 1024-entry LUT with
  linear interpolation is ~15 and is visually indistinguishable on LEDs. Same for `pow`/`log`/
  `exp`/`atan`.
- **Pixel parity will not hold to ±1** the way `../pi/pixel-check.js` does, *because* of those LUTs.
  Accept it up front: an S3 version should assert a looser tolerance (~±4/255) and fall back to a
  visual check for the LUT-approximated builtins. Do not spend a day chasing a ±1 that was traded
  away deliberately.
- **Textures.** Luts are 16 KB and fine. `sampler3D` trilinear is 8 fetches + 7 lerps — the one
  builtin worth optimising. `webcam{}` is already refused host-side and `tex{'url'}` is unimplemented
  at both ends, so neither is a new limitation here.
- **Pacing matters more than on a wall.** The Pi self-paces to the host's rAF by rendering on packet
  arrival. WiFi jitter (10–50 ms bursts, far worse with power-save on) reads as visible stutter on
  LEDs in a way it does not on a panel. Disable WiFi power-save, and consider a local phase-locked
  clock driven from the `beat`/`hostTime` fields already reserved in the frame packet header — which
  is exactly what "Time sync" in `../CLAUDE.md`'s open questions anticipated.

---

## 6. Risks

1. **The compiler is the whole project.** Everything else is a port. If the emitted GLSL is less
   regular than the samples suggest, it grows without bound.
2. **Codegen drift.** A new visual node emitting an unhandled construct silently breaks the LED
   display. Mitigation: build the compiler + VM so it **also compiles for the host**, exactly the
   trick `../pi/render.c` uses to compile out its GLES half — then a golden-corpus test can run every
   generated shader through it on a Mac. This is the single most valuable testing decision available
   here, and it is the same one that made the Pi's protocol side debuggable before hardware existed.
3. **The performance table in §4 is an estimate, not a measurement.** Pixelblaze is the anchor, not
   a benchmark of this VM.
4. **`loop{}` chains and the sdf library may simply be too slow.** Acceptable — `stat` already
   carries `fps` and `renderMs`, so the performer can see it.

### On the alternatives

**There is no smaller board that runs our GLSL unchanged.** The Pi Zero 2 W is VideoCore IV /
GLES 2.0 — the exact limit the 3B+ hit, and the reason this project went to a 4B. So the ESP32-S3
route is genuinely *the* lightweight option, and its price is a compiler.

**Pixel-push is the back pocket.** The host renders in WebGL (it already can — same `built` object,
just don't tap it away), reads back only the LED coordinates and ships N × RGB per frame. 2,000 LEDs
is 360 kB/s, trivial for S3 WiFi, and the device work is ~200 lines. It is an additive protocol
extension (§14 permits it without a proto bump; `flags` and `layerCount` are reserved room). It is
the **only** route that could ever put `webcam{}` or the scope/FFT textures on LEDs, and it is the
fallback if the benchmark below comes back badly. It is not the place to start, because it adds
host-side protocol work that the recommended route does not need at all.

---

## 7. Before committing: two measurements

Both are cheap, and together they replace every estimate above with a number.

**A. Corpus survey (~half a day, no hardware).** Dump `built.source` for every px chain in
`examples.limut`, `lib/sdf.limut` and `lib/visual.limut`, then count distinct constructs, statement
counts, builtin frequencies and loop iteration counts. Output: the exact grammar the compiler must
accept, and a realistic distribution of chain lengths. Extend `draw/visualsynth/codegen.js`'s inline
`?test` block, or script it against the existing headless-Chrome harness in `../mock/`.

**B. VM benchmark (~a day, one dev board).** Write the `vec4` VM alone — no protocol, no LEDs — and
run a hand-assembled 30-statement program over 1,000 pixels on an S3 at 240 MHz, both cores, with
LUT transcendentals. Report pixel-evals/sec. That number replaces the whole table in §4.

If B lands anywhere near 48k px/s, this is straightforwardly worth building. If it lands below
~15k, revisit pixel-push instead.

Only after both: the port itself, in the order **protocol → `mock/selftest.js --endpoint` green →
compiler → VM → LED output**, with `test bars|grid|off` (already in the protocol, already in
`../pi/patterns.c`) as the LED bring-up path before any shader exists.

---

## References for the external figures

- [ESP32-S3 datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf)
- [Espressif: FPUs on Espressif SoCs](https://developer.espressif.com/blog/2025/10/cores_with_fpu/)
- [FastLED — ESP32 platform notes, parallel I2S output](https://github.com/FastLED/FastLED/blob/master/src/platforms/esp/32/README.md)
- [I2SClocklessLedDriver](https://github.com/hpwit/I2SClocklessLedDriver)
- [Pixelblaze V3](https://www.crowdsupply.com/hencke-technologies/pixelblaze-v3) — the ~48,000 px/s anchor
- [fragbyte — GLSL to bytecode compiler and CPU VM](https://github.com/divanburger/fragbyte) — precedent for the approach
- [LVGL on Espressif PPA](https://lvgl.io/docs/open/integration/chip_vendors/espressif/hardware_accelerator_ppa) — the ESP32-P4's 2D accelerator, for why it does not help
