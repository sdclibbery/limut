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

That holds for **native** source nodes. AudioWorklet sources are a third category with
different rules.

### AudioWorkletNode termination (`superosc`, `chaos`, `pwm`)

These are not native sources and `stop()` does not stop them. The shared `stop()` shim in
`play/worklet-lifecycle.js` only writes 1 to a `stop` AudioParam; the node only dies when
**the render thread runs `process()` again and observes it**, at which point `process()`
returns `false`. Two rules follow, and both are already implemented — don't undo either:

- **Register the node with the destructor immediately after construction**, before any
  param evaluation. An unstopped worklet renders forever, so it must not depend on the
  rest of the synth body not throwing (the player error is swallowed by the per-player
  try/catch in `main.js`, so such a leak is silent). Sites: `play/synth/superosc.js`,
  `play/synth/pwm.js`, and the `superosc`/`chaos` node functions in `play/nodes/source.js`.
- **The `process()` lifecycle guard tests `stop` before `start`**, so a node stopped
  before it was ever started terminates instead of sitting in the unstarted branch
  rendering forever. Backing it up, the unstarted branch only stays alive for 60s of
  samples (`this.unstartedSamples`), far beyond any scheduling lookahead, so a node that
  is never started *or* stopped still dies. The guard is duplicated verbatim in the three
  processor source strings (they must stay self-contained for the `worklet-dsp` Node
  harness, which reads them as raw text) — keep the copies identical, and see the comment
  in `play/worklet-lifecycle.js`.
- **Every path that returns `false` posts `'terminated'` back to the node first**, and the
  shim decrements `system.voiceCount()` on that message rather than in `stop()` — the
  count means "still on the audio thread", so only the render thread can retire it.

Both were broken until Aug 2026: with `stop` checked second, one permanently rendering
worklet leaked per event whenever a synth body threw between construction and `start()`
(measured in-app with `p1 superosc E..E., sync=0/0`: voice count 3, 6, 9, 13, 16, 19, and
still 19 after the player was removed; fixed build stays at 0–1). If you touch either rule,
re-run that A/B — it is the cheapest proof available.

Other facts, still true:

- Disconnecting in the same tick as `stop()` is **fine** — verified in both engines, at up
  to 6,000 nodes in 10s, including when disconnected synchronously. Blink keeps calling
  `process()` on a disconnected worklet until it returns false. Don't "fix" this.
- Stop scheduled *before* a future start terminates the node at the stop (the guard's
  order); a stop scheduled *after* the start behaves normally.
- `system.voiceCount()` decrements when the processor reports its own termination (the
  `'terminated'` port message, posted just before `process()` returns `false`), so it
  tracks what the render thread is really running — including the cases `stop()` cannot
  see: the quantum before the processor reads the param, and a node stopped while the
  context is suspended, which never terminates at all. It lags real termination by that
  quantum plus the port hop. For a definitive census of *node objects* (as opposed to live
  processors) use `queryObjects(AudioWorkletNode)` in DevTools or a `FinalizationRegistry`
  harness (see `verifier-audio-wiring`).

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

Many "effects" (`echo`, `pingpong`, `flanger`, `phaser`, `shifter`, `reverb`, `tape`, `multiband`/`multiband4`/`multibandbp`, etc.) are **not JS code** — they are DSL functions defined via `set` in `lib/effects.limut`, loaded at startup via `include`. They are thin wrappers around lower-level node functions in `play/nodes/nodes.js` and `play/nodes/graph.js` (e.g. `multiband` builds its crossover from `parallel` + `bwlpf` and per-band connectable subtraction).

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
- **`{expandingChords: true}`**: returns `0` (a chord-slot placeholder) for any value marked `_chordPlaceholder` — node functions, node-valued vars, and `this.*` lookups — so chord expansion can detect array structure without prematurely building audio nodes or realising this-references. Set only by `player/expand-chords.js`. (Formerly `ignoreThisVars`; the flag it gates was formerly `_thisVar`.)

## `isConnectable` vs `isConnectableOrPlaceholder` (`play/nodes/connect.js`)

Two near-identical predicates with one critical difference: `isConnectableOrPlaceholder(0) === true` (the `0` placeholder branch); `isConnectable(0) === false`. The placeholder branch exists for *per-chord-slot* wiring, where a `0` legitimately means "this slot of the chord has no audio chain — emit nothing here." `expression/connectOp.js` (the `>>` operator) selects between the two by mode: it uses `isConnectableOrPlaceholder` **only while expanding chords** (`evalRecurse.options.expandingChords`), and the strict `isConnectable` in normal playback — otherwise a value that resolves to `0` (eg a `duck`-style timevar at its start) would be misread as an empty slot and the chain would go silent.

**Don't use `isConnectableOrPlaceholder` at single-chain construction sites.** The common pattern

```js
chain = evalParamEvent(expr, params)
if (!isConnectable(chain)) { chain = vars.all().gain({value:expr}, params, b) }
```

decides whether the evaluated value is already a wired audio graph, or a scalar/timevar that needs wrapping in a gain node whose `.gain` automates against `expr`. A timevar like `[0,1]t1/8@f` evaluates at event time to its starting sample (here `0`). With `isConnectableOrPlaceholder`, the `0` is wrongly accepted as a "connectable placeholder" and the gain-wrap fallback is skipped → `chain` stays the bare number `0` → `connect()` resolves it to `[]` (chord-empty-slot semantics, `connect.js:38`) → no audio connections are made → silence.

Rule of thumb:

- **Per-chord-slot wiring** (`expression/connectOp.js` *while* `expandingChords`, where each operand may legitimately be a "no-op for this slot"): `isConnectableOrPlaceholder`.
- **Single-chain construction** (player-fx, loop/mix node functions, connectOp in normal playback — anything that wraps "if it's not already a node, make one"): `isConnectable`.

When the values flowing in could be scalars (including `0`) — i.e. always with timevars — the placeholder branch silences output. Live sites using the correct predicate: `play/player-fx.js:101`, `play/nodes/graph.js:46,49,84,117,127`.

### Wrapping a *lambda* result in a gain — wrap the lambda, not the probe value

A subtle variant of the single-chain pattern arises in node functions that take a per-item lambda — `parallel{{i}->..., n}` and `series{{i}->..., n}` in `play/nodes/graph.js`. (The DSL `multiband` in `lib/effects.limut` is a wrapper over `parallel`, so it inherits all of this.) The chain is built once, so the code calls the lambda to find out whether it produced a node chain or a plain value:

```js
proc = callback(ev, b, evalParamFrame, {value:i}) // probe
```

That probe **eagerly evaluates the lambda body**, collapsing a time-varying expression (e.g. `[]n{seed:i}`, interval `'frame'`) to a single frozen number. So you must **not** wrap the probe result (`gain({value:proc})` → static gain, never moves). Instead, when the probe is not connectable, hand the *lambda itself* to gain as the value param and let gain's `evalMainParamFrame` re-derive the interval at runtime:

```js
if (!isConnectable(proc)) {
  let copyGain = (e2,b2,er2) => callback(ev, b2, er2, {value:i})
  proc = vars.all().gain({value:copyGain}, e,b)
}
```

Because gain evaluates its `value` with `{withInterval:true}` and that flag threads through the nested lambda body (`evalRecurseWithOptions`, `player/eval-param.js`), a frame-varying body gets `doPerFrame` updates while a genuinely static body (`{i}->0.5`) stays a constant gain with no per-frame callback — i.e. it behaves exactly like `gain{<body>}` with the lambda's arg bound. **Don't** decide per-frame-vs-static from the lambda's static `.interval` property: with conditionals like `{i}->i%2==0?[]n:0.5` the effective interval is only known by evaluating, which is precisely what the `withInterval` path does.

(The same per-frame behaviour falls out for free in pure-DSL wrappers: when a lambda call like `chain{i}` evaluates to a plain value on the right of `>>`, `connectOp` wraps the **raw unevaluated AST** in `gain{value:<ast>}`, so gain's `withInterval` eval drives per-frame updates with the call context snapshot supplying `i`. This is how the DSL `multiband` supports amplitude-valued callbacks like `{i}->[]n{seed:i}` with no special handling.)

Re-use the same per-copy cloned event (`ev`) inside the wrapper: param memoisation is keyed by `(event, beat)` and ignores the lambda's args, so passing the shared fx event collapses every item to item 0's value. The probe (no `withInterval`) and gain's eval (`withInterval`) memoise under distinct keys, so they don't collide.

**Why a distinct event rather than `{doNotMemoise:true}`?** It's a fair question — `series`' non-lambda branch (`graph.js:92`) *does* eval its chain with `doNotMemoise` to get fresh nodes per repeat (its lambda branch uses the cloned-event pattern, same as parallel), and `doNotMemoise` genuinely *does* propagate into a lambda body (when routed through `evalParamFrame`, `evalRecurseWithOptions` bakes the options into the `er` handed to the user-function wrapper, which then evals the body with it — cf. shaper at `play/nodes/nodes.js:43`, which samples a static scalar curve this way). So for the **node-chain** branch, `doNotMemoise` would work. The blocker is the **amplitude/gain** branch above: that body can vary per frame, so the node function can't eval it once and freeze it — it hands the live lambda to `gain`, which re-evaluates it **every frame**. The node function doesn't own that eval call, so it can't inject `doNotMemoise` there (and wouldn't want to — per-frame memoisation should stay *on* so each frame computes once). The only seam to keep copy *i* out of copy 0's bucket inside gain's per-frame memoisation is the **event identity** (the WeakMap key) — which is exactly why `copyGain` hardcodes the captured `ev` and ignores the `e2` gain passes in. Given the amplitude branch forces event-identity isolation, the node-chain branch reuses the same `ev` for uniformity rather than switching to `doNotMemoise`. Takeaway: `doNotMemoise` is "never memoise, ever" (right for a one-shot static sample like shaper); a cloned event isolates *across* evaluations while leaving per-frame/intra-evaluation memoisation intact (right when something else owns the per-frame eval loop).

## GainNode pooling (`play/node-pool.js`) and the Chrome param-write race

`createGain` is patched on the audio context to reuse pooled GainNodes (gains only — sources are single-use, filters carry audible internal state). Only **per-event** destructors (`destructor(true)`, set in `envelope()`) release nodes back; long-lived chain destructors don't, because their nodes may have inbound edges that outlive them. Guards: `__pooled` (double-release), `__gen` (bumped per acquire; destructors snapshot it at registration and skip nodes that were reused by a newer owner since).

**The cardinal rule (June 2026 crackle bug): never write an AudioParam — or channel config — on a node that might still be wired.** In Chrome/Electron (not Firefox), a param write like `gain.value = 1` issued in the same JS task *after* `node.disconnect()` can be applied by the render thread one quantum *before* the disconnect — the old signal blasts through at the new value for ~one quantum. At per-event rates that's a nasty crackle. It only needs one live inbound edge: destructor registration order (`envelope()` registers the vca before `filters.js` registers the biquad) means a released vca transiently still has the filter connected into it, carrying the just-stopped oscillator's tail.

Hence the pool's design: `release()` only flags and pushes to a **quarantine**; all resets (`cancelScheduledValues`, `value = 1`, `delete gain.lastTime`, channel config) happen in `flushQuarantine()` (called from the patched `createGain`), and only for nodes whose release is older than `quarantineTime` (0.1s) **on the audio clock** — if `audioCtx.currentTime` advanced, the render thread processed quanta, so the destructor's disconnects are provably applied and the node is unwired. Don't "optimise" the resets back to release time, and don't age the quarantine on wall clock (a stalled render thread would break the guarantee).

Related facts:
- `delete n.gain.lastTime` at flush matters: `doPerFrame` (eval-audio-params) stashes `lastTime` on the AudioParam; a stale value on a reused node causes a catch-up `setTargetAtTime` scheduling loop.
- `cancelScheduledValues(0)` is glitch-safe in Chrome — after cancel the param holds its last computed value (it does *not* snap back to the intrinsic `.value`). Only explicit value writes jump.
- Nodes acquired from the pool are contract-identical to fresh nodes (gain 1, empty timeline, 2ch/'max'/'speakers') — consumers like `fxMixChain`'s `chain.in`, `choke`, and `mono` rely on default gain 1 without setting it.
- A plain player with default `amp` creates **two** pooled gains per event: the envelope vca *and* a `perFrameAmp` vca (default amp evaluates to a function, so `perFrameAmp` always wraps).
- `?nopool` disables pooling for A/B comparison; `limutNodePool.stats()` (incl. `quarantined`) from the console.

## Verifying audio-graph wiring and audible output at runtime

Headless Chrome has no speakers but still renders the realtime context to a null sink. Two runtime checks are possible: inspect the *constructed graph* (`players.getById('p1')._fx.chain` — an `AudioNode`, a scalar, or a wrapped object?), and scan the *rendered samples* for discontinuities via the master `AnalyserNode` (`system.analyser` time-domain deltas) — the way to catch clicks/crackles numerically. Note that `OfflineAudioContext` re-creations of a call sequence do **not** reproduce realtime main-thread/render-thread races; test the real app. See the `verifier-audio-wiring` skill for both harness patterns.

## Audio thread load and dropouts are NOT observable from JS

Do not go looking for an audio-load or underrun metric — there isn't one, and the search has already been done (Aug 2026, against Chrome 151 and Electron 36; the findings are also recorded in a comment in `play/system.js`):

- **`AudioContext.renderCapacity`** — the API designed for exactly this (`averageLoad`, `peakLoad`, `underrunRatio`) — has never shipped unflagged. Absent from `AudioContext.prototype` in both.
- **`AudioWorkletGlobalScope` has no `performance`**, so a monitor worklet cannot time itself. It only gets `sampleRate`, `currentTime` and `currentFrame`.
- **`currentTime` and `getOutputTimestamp()` both track the output device buffer**, and stay flat even when the audio thread is deliberately driven past its deadline. Their difference is just the fixed device buffer (~20ms), not a headroom signal.
- **Electron's `app.getAppMetrics()`** does expose real CPU, but AudioWorklets run in the *renderer* process (the Audio Service process only does device I/O), so it conflates the audio thread with the main thread and the WebGL work.

What exists instead: `system.voiceCount()` / `limutAudio.stats()` — a live count of worklet voices (superosc, chaos, pwm), incremented at construction and decremented when the processor itself reports termination. Those are the expensive things on the audio thread, so the count plus a known per-voice cost is the usable proxy. Measure per-voice cost offline with the `worklet-dsp` skill.

**Caveat:** it is still a count of voices, not a load measurement — cost per voice varies hugely (superosc `unison` especially) — and it lags a real termination by a render quantum plus the port hop. See "AudioWorkletNode termination" above.

**The UI readout labelled "Timing" is a main-thread meter, not an audio one.** It is `beatLatency` in `main.js` — wall-clock jitter between beat firings — and beats fire from the `requestAnimationFrame` loop, so heavy visuals or a busy machine turn it red while the synths are fine. It was labelled "Audio" until Aug 2026 and the docs described it as an audio-health indicator, which it has never been. A real render underrun produces *no* change in it.
