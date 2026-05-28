---
name: audio-internals
description: Internals of the limut audio node graph, lifecycle, and parameter evaluation. Use when modifying anything under play/, expression/connectOp.js, expression/connectableOps.js, play/nodes/, play/effects/, play/envelopes.js, play/player-fx.js, or play/eval-audio-params.js — or when debugging audio leaks, "_destructor is undefined" errors, fx chain bugs, or Web Audio API constraint violations.
---

# limut audio internals

## `_destructor` object

Every per-event audio context has `params._destructor` set on it before audio nodes are created. It tracks nodes that need cleanup:

- `destructor.stop(node)` — registers a node to be stopped when the event ends
- `destructor.disconnect(node)` — registers a node to be disconnected
- `destructor.destroy()` — called at event end; stops and disconnects all registered nodes

**For per-event players** (e.g. `audiosynth`), `_destructor` is set inside `envelope()` in `play/envelopes.js`.

**For persistent fx chains**, `_destructor` is set inside `createPlayerFxChain()` in `play/player-fx.js` (using the fx chain's own long-lived destructor).

A missing `_destructor` (`e._destructor is undefined`) means an audio node is being created in a context where lifecycle tracking hasn't been set up — e.g. during arithmetic/connectable evaluation in an `fx=` expression, or in test code that passes a bare `{}` event.

### `stop` vs `disconnect` — both matter, but differently

- **Source nodes** (`OscillatorNode`, `ConstantSourceNode`, `AudioBufferSourceNode`) need **both** `stop()` and `disconnect()`. A disconnected-but-not-stopped source node becomes silent but keeps consuming audio rendering CPU and is held in destructor lists, preventing GC. It will run until the tab closes.
- **Processing nodes** (`GainNode`, `StereoPannerNode`, filters, etc.) only need `disconnect()`. They have no running state; once disconnected from the graph they become inert.

### Safe guard pattern for source nodes

Stop immediately as fallback so nodes are never leaked:

```js
if (e && e._destructor) { e._destructor.stop(node) } else { node.stop() }
```

### Safe guard pattern for processing nodes

(used in `expression/connectOp.js`) — disconnect is sufficient:

```js
if (e && e._destructor) { e._destructor.disconnect(node) }
// No else needed: a disconnected GainNode etc. is inert with no running state to clean up
```

`node.stop()` with no argument stops at `currentTime`. If called before `start()` fires (e.g. if `start()` was scheduled in the future), the node produces no audio — safe and correct.

## Expression operator precedence

Defined in `expression/operators.js`. Lower number = tighter binding (evaluated first):

| Precedence | Operators |
|---|---|
| 1 | `.` (property/subparam lookup) |
| 2 | `\|` |
| 3 | `^` |
| 4 | `%`, `/`, `*` |
| 5 | `-`, `+` |
| 6 | `==`, `!=`, `<`, `>`, `<=`, `>=` |
| 7 | `>>` (audio node connect) |
| 8 | `??` |
| 9 | `?:` |

So `(1+osc.saw>>gain)*0.003` parses as `((1+(osc.saw))>>gain)*0.003` — `.` first, then `+`, then `>>`, then `*`.

## AudioNode connect operator (`>>`)

Defined in `expression/connectOp.js`. Has `doNotEvalArgs=true` and `raw=true` — it receives raw AST nodes and evaluates them itself via `evalRecurse`. This allows it to build the Web Audio signal chain (`.connect()`) between nodes. Already guards `_destructor` usage at line 37.

## Connectable arithmetic (`connectableOps.js`)

When arithmetic operators (`+`, `*`, etc.) produce or consume an AudioNode, they dispatch to connectable variants in `expression/connectableOps.js`. `connectableAdd` (and similar) wrap non-AudioNode operands in a `ConstantSource` node via `vars.all().const(...)`. This means expressions like `1+osc.saw` cause a `constNode` to be created — so `_destructor` guards are needed in node creation functions too.

## Audio node creation (`play/nodes/source.js`)

Contains `osc`, `constNode`, and `sample` node functions. These are callable from DSL expressions (e.g. `osc.saw`, `sample:'foo'`). All three are source nodes — they need both `stop()` and `disconnect()`. Guard pattern:

```js
if (e && e._destructor) { e._destructor.stop(node) } else { node.stop() }
```

The `else { node.stop() }` is critical: without it, nodes created in a missing-destructor context (e.g. connectable arithmetic, tests) would be disconnected eventually but never stopped, leaking audio rendering resources.

## `audiosynth` player flow

1. `envelope(params)` → sets `params._destructor`, creates VCA gain node
2. `evalParamEvent(params.play, params)` → evaluates `play=` expression to get source AudioNode chain
3. If no `play=` param: `fxMixChain(params, vca)` — fx chain connects directly to VCA
4. If `play=` present: `waveEffects → effects → playChain → vca`, and `fxMixChain` wraps VCA with per-frame amp

`fxMixChain` (`play/effects/fxMixChain.js`) manages the persistent per-player fx chain, calling `createPlayerFxChain` (`play/player-fx.js`) which evaluates the `fx=` expression with its own long-lived destructor.

## DSL-defined effect functions (`lib/effects.limut`)

Many "effects" (`echo`, `pingpong`, `flanger`, `phaser`, `shifter`, `reverb`, `tape`, etc.) are **not JS code** — they are DSL functions defined via `set` in `lib/effects.limut`, loaded at startup via `include`. They are thin wrappers around lower-level node functions in `play/nodes/nodes.js`.

For example, the DSL `echo` function wraps the `delay` node function. When debugging effect errors, check `lib/effects.limut` first to see how the DSL function maps parameters before passing them to the underlying node function.

## Audio node functions (`play/nodes/nodes.js`)

Contains JS implementations of node functions callable from DSL expressions: `delay`, `gain`, `shaper`, `panner`, `lfo`, `apf`, `series`, `convolver`, `idnode`, etc. These are registered via `addNodeFunction()` and looked up by name during expression evaluation.

The `delay` node function creates a Web Audio `DelayNode` — its `max` parameter sets `maxDelayTime`, which the Web Audio API requires to be in range `(0, 180]`.

## Expression value ranges and Web Audio API constraints

DSL expressions can produce any numeric value, including 0 and negatives. Key examples:

- `[]n` (Perlin noise, no range) — raw noise from `eval-randoms.js:simpleNoise`, range roughly -0.3 to 1, **can be exactly 0** at integer beat boundaries.
- `[]r` (random, no range) — 0 to 1 inclusive.
- Arithmetic on these can amplify edge cases.

Web Audio API `createDelay()` requires `maxDelayTime > 0`. When DSL expressions flow through to node creation parameters (e.g. `echo{[]n}` → DSL echo function → `delay{time, max:time*2}` → `createDelay(0)`), zero/negative values cause runtime errors. Guard with `Math.max(0.001, ...)` at the node creation boundary.

## Parameter evaluation flow (`play/eval-audio-params.js`)

Two evaluation modes, each with main/sub variants:

- **Per-event** (`evalMainParamEvent`, `evalSubParamEvent`): evaluates once when the audio event starts. Used for fixed values like `maxDelayTime`.
- **Per-frame** (`evalMainParamFrame`, `evalSubParamFrame`): sets up ongoing `setTargetAtTime` updates on an AudioParam, enabling time-varying parameters.

`evalPerEvent` returns the default only when the value is falsy AND not a number. **Zero is not treated as missing** — `typeof 0 !== 'number'` is false, so `0` passes through as a valid value rather than falling back to the default. This is correct for most params but means node creation code must handle 0 explicitly where the Web Audio API forbids it.

### `evalParamFrame` options

`evalParamFrame(value, event, beat, options)` where `options` controls evaluation:

- **default (no options)**: full evaluation — functions called, objects iterated and each field evaluated via evalRecurse, arrays mapped and flattened.
- **`{evalToObjectOrPrimitive: true}`**: object fields pass through *unevaluated*. Used when you want to inspect the map structure (e.g. find subparams) without forcing evaluation. The `stutter` and `delay` param handlers use this to access `.dur`, `.add`, etc. as raw expressions.
- **`{withInterval: true}`**: wraps per-frame results with their interval metadata; used by per-frame audio param scheduling.
- **`{ignoreThisVars: true}`**: returns 0 for `this.*` lookups (used during chord expansion to avoid premature this-evaluation).

## `isConnectable` vs `isConnectableOrPlaceholder` (`play/nodes/connect.js`)

Two near-identical predicates with one critical difference: `isConnectableOrPlaceholder(0) === true` (the `0` placeholder branch); `isConnectable(0) === false`. The placeholder branch exists for *per-chord-slot* wiring in `expression/connectOp.js:21,25`, where a `0` legitimately means "this slot of the chord has no audio chain — emit nothing here."

**Don't use `isConnectableOrPlaceholder` at single-chain construction sites.** The common pattern

```js
chain = evalParamEvent(expr, params)
if (!isConnectable(chain)) { chain = vars.all().gain({value:expr}, params, b) }
```

decides whether the evaluated value is already a wired audio graph, or a scalar/timevar that needs wrapping in a gain node whose `.gain` automates against `expr`. A timevar like `[0,1]t1/8@f` evaluates at event time to its starting sample (here `0`). With `isConnectableOrPlaceholder`, the `0` is wrongly accepted as a "connectable placeholder" and the gain-wrap fallback is skipped → `chain` stays the bare number `0` → `connect()` resolves it to `[]` (chord-empty-slot semantics, `connect.js:38`) → no audio connections are made → silence.

Rule of thumb:

- **Per-chord-slot wiring** (`expression/connectOp.js`, where each operand may legitimately be a "no-op for this slot"): `isConnectableOrPlaceholder`.
- **Single-chain construction** (player-fx, loop/mix node functions, anything that wraps "if it's not already a node, make one"): `isConnectable`.

When the values flowing in could be scalars (including `0`) — i.e. always with timevars — the placeholder branch silences output. Live sites using the correct predicate: `play/player-fx.js:101`, `play/nodes/graph.js:46,49,87,118,126`.

## Verifying audio-graph wiring at runtime

Audio output is not observable in headless Chrome — listening tests aren't possible. But the *constructed graph* is observable: after driving the app's update-code path, you can inspect `players.getById('p1')._fx.chain` and check whether it's an `AudioNode`, a scalar, or a wrapped object. For non-trivial fx/connect/wiring changes, this is the only meaningful runtime check beyond the inline test suite. See the `verifier-audio-wiring` skill for the harness pattern.
