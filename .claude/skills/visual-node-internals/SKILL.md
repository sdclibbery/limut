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
- `toVec4(v)` converts an evaluated param to 4 components: `unwrapValue` strips `.value` wrappers (units, timevar segments) in a loop first; number splats to all channels; objects read the exported `channelNames` table, first name defined wins (`x r u s` / `y g v t` / `z b p` / `w a q`, so `w` is always the 4th component and `p` is uvwq's 3rd), defaulting 0 for channels 0-2 and 1 for alpha; fallback neutral `[1,1,1,1]`. It writes into a shared scratch Float32Array — consume (gl.uniform4fv) before calling again.
- `toVec4` cannot tell an absent channel from a zero one, and `draw/visualsynth.js` calls it unconditionally, so **which** channels a param names is worked out at event time instead, in `nodes.js`: `channelMask`/`paramSources`/`emitChannels` back `set{}`, `add{}` and `mul{}`. A colour or map literal is already a plain object so its keys are read without evaluating; anything else is evaluated once purely for its key set, while the raw AST still goes to `addUniform` so the values keep animating. Named channel args (`set{u:1/2}`) each get their own uniform and beat the positional value. Uniforms are allocated positional-first then in channel order — the source is the program cache key. All three nodes keep a whole-vector fast path (`v0 * u_vs0`) for an unmasked param, so plain numbers generate the same source they always did.

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

`connectOp` has two branches before the audio path:

1. **Pipe** — if the RHS is a callable var lookup that is *not* a node function (`r.isVarLookup && !r._chordPlaceholder`, target `isVarFunction`) and the evaluated LHS is not `connectable`, `>>` calls the RHS with the LHS as its first argument (`r.args = el` then `evalFunctionWithModifiers`, the same mechanism `lookupOp` uses for `.`). This is how maths functions and user-defined visual functions join a chain: `tex{} >> floor{1/40}` is `floor{texNode, 1/40}`, and floor turns into a node by ordinary argument dispatch. `r.args` is saved/restored because the same parse instance is also reachable down non-piping paths.

   **When the LHS is a shader node the callee gets a `passthroughShaderNode()` instead of the chain, and the result is `composeShaderNodes(el, result)`.** A piped call is therefore a chain *segment*, not a new chain seeded from the raw coordinate: the incoming value reaches the result both through the argument (`dot{in,#3b1}`) and as the segment's own input (the dry side of `mix{wet,t}`). Substitution is what makes composing safe — composing the chain onto a result that already embedded it would emit it twice. Without this, `set monochrome = {in,v:1} -> mix{dot{in,#3b1},v}` blends against `v0`, i.e. the uv gradient (the reported "radial rainbow"). Only a visual result is composed; a non-node result is returned as it stands. Note the direct-call form (`px=monochrome{tex{'a.png'},1/2}`) is *not* piped, so `mix{}` there still takes its implicit dry from `v0` — pipe it, or pass the dry side explicitly.
2. **Compose** — otherwise both operands are evaluated and, if either `isShaderNode`, it returns `composeShaderNodes(...)` with non-node sides const-wrapped from their **raw ASTs**; the audio path is never reached.

The node-function exclusion is what keeps `osc{} >> lpf{500}` and `mul{2} >> tex{}` wires rather than calls, and the `!connectable(el)` guard keeps DSL-defined audio effects (`shifter{2} >> reverb{1b}`, where `reverb` is a lambda) connecting as before. During `expandingChords` the placeholder-aware `isConnectableOrPlaceholder` is used, so a `0` placeholder counts as connectable and no piping happens mid-expansion.

Consequence for chains: a maths function on the **left** of `>>` has nothing to consume, so seed with `id` — `px=id>>floor{1/40}>>tex{}`, not `px=floor{1/40}>>tex{}` (which const-wraps a plain 0).

Mixing domains (`osc{} >> tex{}`) is undefined behaviour — the shader branch wins if either side is a shader node and the audio side gets const-wrapped into a meaningless uniform. Arithmetic operators (`+ - * / % ^` and comparisons) **do** dispatch on shader nodes, via `expression/shaderNodeOps.js` wired onto `operators[k].shaderNodeOp` and dispatched in `eval-operator.js` ahead of the connectable check. They emit expressions, not extra chain stages, and get both the raw AST and evaluated value per side so a non-node side becomes an animated uniform. Unlike `>>`, they do not pipe: `id/2 + floor{1/8}` adds a constant, write `id/2 + floor{id,1/8}`.

## Maths functions (`draw/visualsynth/shader-maths.js`)

`shaderAware(name, numericFn)` wraps a registered var function so it emits GLSL when any argument `isShaderNode`, and calls `numericFn` unchanged otherwise — the same "dispatch on the value, not on a mode flag" rule as the operators, so scalar behaviour is untouched. Used by `functions/maths.js` (`addMathsFunction`) and for `min`/`max` in `functions/aggregators.js`. Each function has a spec of `{emit, operands}`; add a new one there, not in `nodes.js`.

Two things a new spec must respect:

- The shader path returns `{value: node, _finalResult: true}`. The wrapper is what makes postfix (`(id*4).floor`) work — `lookupOp` short-circuits on `_finalResult`, and `eval-param.js` unwraps it. Returning a bare node makes `.` fall through to a map lookup and yield `undefined`.
- Non-node operands must register their **raw AST**, not the evaluated value, or they freeze at event time. `parse-var` supplies them as `modifiers.__rawArgs` when the function sets `wantsRawArgs` (guarded on non-empty args so an argless call still returns the bare key string), already shifted in step with the evaluated args when the call was piped.

`mix` is the one visual node that dispatches out of an *audio* node function: `play/nodes/graph.js`'s `mix` calls `mixShaderNode` (`draw/visualsynth/shader-mix.js`) right after it evaluates its main arg, and falls through to the dry/wet gains when that returns `undefined`. Two constraints there. **Detection must not evaluate the other args in the audio case** — evaluating an audio chain eagerly constructs nodes — so only the already-evaluated main arg is tested, plus `value1` when a third positional is present (audio `mix` never reads one, so its presence already proves this isn't audio). And because `mix{wet,t}` takes its dry side from the value coming down the chain, it uses `naryShaderNodeWithInput`, the variant whose `emit` also receives the build input; `naryShaderNode`'s signature can't change because `variadic` in `shader-maths.js` spreads names straight into a `reduce`. `mix{wet,t}`'s implicit dry is why the pipe branch in `connectOp` substitutes a pass-through node and composes (see the `>>` seam above) — that is the change that made `{in,v:1} -> mix{dot{in,#3b1},v}` work. `lib/nodes.limut`'s `mix2`…`mix8` stay audio-only: their single argument is the wet chain, so piping puts the incoming value there rather than on the dry side.

## Call context in uniforms

Uniform ASTs are re-evaluated every frame, long after the expression that wrote them returned. If a node was created inside a user-defined function (`set pixellate = {in,size} -> floor{in,to:1/size}`), the AST `1/size` only resolves in that call context. So `makeShaderNode` snapshots `getCallTree()` at creation and reinstalls it around `build`; `ctx.addUniform` records whatever tree is current onto the uniform entry; and `draw/visualsynth.js`'s `preRender` brackets each per-frame eval with `setCallTree`/`clearCallTree`. This mirrors `doPerFrame` in `play/eval-audio-params.js`. Symptom if it regresses: a user-defined visual function renders black (the arg evaluates to 0, so a `to:` becomes 1/0).

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
- **Per-frame animated uniforms**: `s.preRender(state)` (the hook sprite.js calls before each draw) does `gl.useProgram` then, per uniform, restores that uniform's captured call tree, `evalParamFrame(u.ast, params, state.count)` → `toVec4` → `gl.uniform4fv`. This is the visual analogue of `play/eval-audio-params.js` per-frame scheduling; see "Call context in uniforms" above.
- Texture binding rides `sprite.js` (`s.texture`, `t.update(state)` per-frame video upload, `l_extents` from `t.width/height`). **sprite.js binds the same texture to every `textureUnif` slot** — that's the reason for the current one-texture-per-chain limit (🟠 warn). Multi-texture needs sprite.js to bind per-slot (e.g. `s.textures[i]` alongside `s.textureUnif[i]`).

## Known limitations (PoC scope, deliberate)

`pal{}`; random/noise/perlin nodes; >1 texture per chain; chords inside px args (placeholders keep them from crashing, results unspecified); no program-cache eviction (matches shadertoy). A maths function or lambda on the left of `>>` gets no implicit input (seed with `id`), and only a plain var-lookup callsite is piped — not a parenthesised expression (`id >> (floor{1/8}*2)`) or a lambda literal.

## Verifying changes

- Codegen and shader-node logic are pure string/JS — inline `?test` blocks in `shader-node.js`, `codegen.js`, plus shader-delegation tests in `connectOp.js` and pass-through tests in `eval-param.js`. Run via the `headless-tests` skill.
- Actual rendering: drive the real app headlessly (the "Driving the whole app" harness in the `headless-tests` skill, needs `--use-angle=swiftshader --enable-unsafe-swiftshader`). `tex{'favicon-32x32.png'}` is the camera-free texture path; check the in-app console (`#console` textarea) for `🔴` and that the canvas is `display: block`. The webcam path cannot be tested headlessly — ask the user to check in a real browser.
- GLSL compile errors: `draw/system.js` `loadShader` includes `getShaderInfoLog` in its thrown string, which the renderer surfaces as `🔴 Visual synth shader error: ...` in the in-app console (once — then cached as permanent failure). Full source dump goes to devtools via console.error.
- A deliberate breakage test: make a node emit invalid GLSL, confirm the 🔴 reaches the in-app console and doesn't spam per event.
