---
name: visual-node-internals
description: Internals of the limut visual node system (visualsynth) — px chains of shader nodes compiled to a single fragment shader. Use when modifying anything under draw/visualsynth/, draw/visualsynth.js, the shader-node branch of expression/connectOp.js, or when adding new visual nodes, texture sources, or extending px chain semantics — or when debugging blank/black visualsynth output, shader compile errors, or animated node params not updating.
---

# limut visual node internals

The visual node system lets `px=mul{[]n4}>>tex{webcam{'5mp'}}` on a `visualsynth` player compile into a single fragment shader. Design intent lives in `ToDo.txt` ("Nodes for visuals" and "Visual nodes Ideas" sections).

## Core architecture: compiler, not interpreter

Audio's `>>` (`expression/connectOp.js`) is an **eager interpreter** — evaluating the expression builds the Web Audio graph. The visual system is a **compiler**: node functions return *shader nodes* (GLSL-emitting build steps), `>>` composes them, and nothing touches GL until the whole chain is built into one shader source. Keep this split: structure decided at event time; scalar args become uniforms re-evaluated per frame. Never make a visual node function create GL resources in its build function — build must stay a pure string emitter (texture *objects* are acquired at event time in the node function, before makeShaderNode).

## The shader node value type (`draw/visualsynth/shader-node.js`)

```js
{ isShaderNode: true, build: (inputExpr, ctx) => outVarName }
```

- `build` appends GLSL statements to `ctx` and returns the name of the vec4 variable holding this node's output. `inputExpr` is a GLSL vec4 expression (usually a var name like `v0`).
- `composeShaderNodes(a, b)` is `a>>b`: `b.build(a.build(input, ctx), ctx)` — data flows left to right.
- `constShaderNode(rawAst)` wraps a non-node `>>` operand: ignores its input, emits an animated uniform. It takes the **raw unevaluated AST** — the direct mirror of connectOp's `gain{value:l}` wrap — so timevars stay animatable. Never pass an evaluated value here; that freezes the animation.
- `toVec4(v)` converts an evaluated param to 4 components: unwraps `.value` wrappers (units, timevar segments) in a loop first; number splats to all channels; objects read `x/y/z/w` else `r/g/b/a` (w/a default 1); fallback neutral `[1,1,1,1]`. It writes into a shared scratch Float32Array — consume (gl.uniform4fv) before calling again.

## Codegen (`draw/visualsynth/codegen.js`)

`buildSource(shaderNode)` runs one left-to-right build walk on a fresh context and assembles a **fully self-contained** shader:

```glsl
#version 300 es
precision highp float;
in vec2 fragCoord;
out vec4 fragColor;
uniform vec2 l_extents;
uniform vec4 u_vs0; ...          // one per animated arg
uniform sampler2D u_vstex0; ...  // one per texture node
void main() {
  vec4 v0 = vec4(fragCoord, 0.0, 1.0);   // implicit uv seed
  <statements...>
  fragColor = <outVar>;
}
```

**Raw shader by explicit user decision**: no `commonProcessors`, no `preprocess`/`postprocess` — the px chain is the whole shader. Do not reintroduce common processing; effects belong as nodes in the chain. Consequences: in-shader standard params (`zoom`, `scroll`, `rotate`, `recol`, `pixellate`, `fore`/`back`, `monochrome`...) do **not** apply to visualsynth; JS-side params (`loc`/`window` quad geometry, `blend`/`additive` GL state, `dur`/`sus` timing, `zorder`, buffer routing) still work.

**Determinism is cache correctness.** All generated names (`vN`, `u_vsN`, `u_vstexN`, and per-tex locals `uvN`/`arN`) come from per-context counters during the single build walk, so the same px expression yields byte-identical source. The compiled-program cache in `draw/visualsynth.js` is keyed on that source text. If you add a node type, derive every generated name from ctx counters — never from anything non-deterministic (object identity, Math.random, wall time), or identical expressions stop sharing programs (renderer runs once per event, so that means a compile per event).

Context helpers: `addStatement(expr)` emits `vec4 vN = expr;` and returns `vN`; `addRaw(stmt)` for non-vec4 lines; `addUniform(rawAst)` → `u_vsN`; `addTexture(texObjOrUndefined)` → `u_vstexN` (undefined sets `ctx.notReady`). Codegen is GL-free on purpose — its tests run without a GL context.

## The `>>` seam (`expression/connectOp.js`)

At the top of `connectOp`, both operands are evaluated first; if either `isShaderNode`, it returns `composeShaderNodes(...)` with non-node sides const-wrapped from their **raw ASTs**, and the audio path (composite creation, destructor, gain-wraps, connect) is never reached. During `expandingChords`, visual node lookups return `0` placeholders (`_chordPlaceholder`), `isShaderNode(0)` is false, so the audio placeholder path runs untouched.

Mixing domains (`osc{} >> tex{}`) is undefined behaviour — the shader branch wins if either side is a shader node and the audio side gets const-wrapped into a meaningless uniform. Arithmetic operators (`+ - * /`) do **not** dispatch on shader nodes (`expression/connectableOps.js` and `eval-operator.js` are audio-only); using them on visual nodes produces garbage. If implementing them, follow the `connectableOp` dispatch pattern in `expression/eval-operator.js:107-111` with an `isShaderNode` check — and remember in GLSL `a*b` is free, so they should emit expressions, not extra chain stages.

## eval-param pass-through (critical)

`player/eval-param.js` object-walking (the `typeof value === 'object'` branch) **calls every function-valued field** of evaluated objects. Two exemptions exist alongside `AudioNode`: `value.isShaderNode` and `value.isVisualTextureSource`. Any new visual value type that carries function fields (build, acquire, update...) through expression evaluation MUST get the same exemption, or its functions get invoked mid-eval and the object is torn apart. Symptom: "X is not a function" at draw time, or textures acquired prematurely/never.

## Node registration (`draw/visualsynth/nodes.js`)

Visual nodes register via the **audio** `addNodeFunction` (`play/nodes/node-var.js`) — it is not audio-specific: it just sets `dontEvalArgs` + `_chordPlaceholder` and calls `addVarFunction`. Signature `(args, e, b, state, evalRecurse)` with args as raw ASTs.

- Args that should animate (become uniforms): keep them raw, hand the AST to `ctx.addUniform` inside build.
- Args that are structural (texture source, mode strings): evaluate at event time with `evalRecurse(args.value, e, b)` in the node function body.
- **Flat namespace warning**: visual nodes share one var namespace with audio nodes and every other var (`mul`, `tex`, `webcam` were verified free). Before adding a name, grep `addVarFunction`/`addNodeFunction` registrations, `predefined-var-defs.js`, and `lib/*.limut` `set` lines. A DSL name in `lib/nodes.limut` silently shadows/collides.
- Texture sources are `{isVisualTextureSource: true, acquire: () => textureObjOrUndefined}` — `tex{}` calls `acquire()` at event time; undefined means "not ready yet" (e.g. webcam pre-enumeration) → `ctx.notReady` → the renderer returns nothing and the *next event* retries (same behaviour as the webcam visual). Webcam texture acquisition lives in `draw/webcam.js` `acquireTexture(device, w, h)` (exported as a property on the renderer function), with its own per-device texture cache separate from the webcam visual's shader cache.

## Renderer (`draw/visualsynth.js`)

Runs **once per visual event** (via `sprite.create`, `draw/sprite.js`). Flow: `evalParamEvent(params.px, params)` → shader node → `buildSource` → program cache lookup by source → per-event `s = Object.create(cached.shader)` carrying `s.texture` and `s.preRender`.

- Program cache is 3-state like shadertoy: `undefined` = not compiled, object = compiled, `null` = permanent failure (never retried, prevents per-event error spam).
- `common.getCommonUniforms(shader)` is still called — it sets up the quad buffers/attrs (`posBuf`/`posAttr`/`fragCoordBuf`/`fragCoordAttr`) that sprite.js needs. Its ~30 uniform locations come back null against the generated shader; `gl.uniform*` with a null location is a silent no-op, which is why sprite.js's standard per-frame writes are harmless. `shader.textureUnif` is overridden to the `u_vstexN` locations (empty array when no textures — prevents sprite.js loading the default favicon texture).
- **Per-frame animated uniforms**: `s.preRender(state)` (the hook sprite.js calls before each draw) does `gl.useProgram` then `evalParamFrame(u.ast, params, state.count)` → `toVec4` → `gl.uniform4fv`. This is the visual analogue of `play/eval-audio-params.js` per-frame scheduling. It does NOT snapshot the call tree (`player/callstack.js`) — lambdas inside px args won't see their arg bindings per frame. If user-defined visual nodes via `set` lambdas are implemented, per-frame uniform eval needs the `getCallTree()`/`setCallTree` bracket that `doPerFrame` uses.
- Texture binding rides `sprite.js` (`s.texture`, `t.update(state)` per-frame video upload, `l_extents` from `t.width/height`). **sprite.js binds the same texture to every `textureUnif` slot** — that's the reason for the current one-texture-per-chain limit (🟠 warn). Multi-texture needs sprite.js to bind per-slot (e.g. `s.textures[i]` alongside `s.textureUnif[i]`).

## Known limitations (PoC scope, deliberate)

Arithmetic ops on shader nodes; glsl-builtin nodes (`sin`, `floor`, `dot`...); `pal{}`; user-defined visual nodes via `set` lambdas (`set pixellate = {size} -> ...` per ToDo); >1 texture per chain; lambda call-context in per-frame uniforms; chords inside px args (placeholders keep them from crashing, results unspecified); no program-cache eviction (matches shadertoy).

## Verifying changes

- Codegen and shader-node logic are pure string/JS — inline `?test` blocks in `shader-node.js`, `codegen.js`, plus shader-delegation tests in `connectOp.js` and pass-through tests in `eval-param.js`. Run via the `headless-tests` skill.
- Actual rendering: drive the real app headlessly (the "Driving the whole app" harness in the `headless-tests` skill, needs `--use-angle=swiftshader --enable-unsafe-swiftshader`). `tex{'favicon-32x32.png'}` is the camera-free texture path; check the in-app console (`#console` textarea) for `🔴` and that the canvas is `display: block`. The webcam path cannot be tested headlessly — ask the user to check in a real browser.
- GLSL compile errors: `draw/system.js` `loadShader` includes `getShaderInfoLog` in its thrown string, which the renderer surfaces as `🔴 Visual synth shader error: ...` in the in-app console (once — then cached as permanent failure). Full source dump goes to devtools via console.error.
- A deliberate breakage test: make a node emit invalid GLSL, confirm the 🔴 reaches the in-app console and doesn't spam per event.
