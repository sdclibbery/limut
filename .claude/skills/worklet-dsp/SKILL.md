---
name: worklet-dsp
description: Test and benchmark AudioWorklet DSP (the process() body of superosc, chaos, pwm) from a shell in pure Node, with no browser and no server. Use when modifying play/superosc-source.js, play/chaos-source.js, play/pwm-source.js, play/wavetable.js, or any other worklet processor source string — especially for refactors and optimisations that must not change the output, and for benchmarking per-voice CPU cost.
---

# Testing and benchmarking limut worklet DSP

Worklet processors are the only part of limut that **no** existing test path reaches. Their
code lives inside a template literal (``const source = `...` ``), gets registered via
`addModule` on a data URL, and runs on the audio thread in a separate global scope. So:

- The inline `?test` suite (see `headless-tests`) never executes a single line of it.
- `verifier-audio-wiring` inspects the *constructed graph*, not the DSP inside a node.
- Headless Chrome renders to a null sink, so per-sample correctness is invisible there.

But the processor is just a class. Extract the string, stub the three globals the spec
provides, and you can drive `process()` directly in Node — which makes worklet DSP the
*easiest* thing in the repo to test exactly, not the hardest.

## When this matters most

Any change to a `process()` body that is supposed to leave the sound **unchanged**:
hoisting, caching, fast paths, loop restructuring, param-read changes. For those the bar
is not "sounds fine" but **bit-identical output**, and that is cheap to prove here.

## The harness

```js
const fs = require('fs')
const SR = 48000, BLOCK = 128

// 1. Extract the worklet source string.
const readSrc = (path) => {
  const f = fs.readFileSync(path, 'utf8')
  const m = 'const source = `'
  const i = f.indexOf(m) + m.length
  return f.slice(i, f.indexOf('`', i))   // safe: the body contains no backticks (see Gotchas)
}

// 2. Evaluate it against a stubbed AudioWorkletGlobalScope. `new Function` (not eval)
//    keeps it out of the enclosing scope and lets the three globals be injected as params.
const load = (src) => {
  let Registered = null
  class AudioWorkletProcessor {
    constructor () { this.port = { onmessage: null, postMessage: () => {} } }
  }
  new Function('sampleRate', 'AudioWorkletProcessor', 'registerProcessor', src)(
    SR, AudioWorkletProcessor, (name, cls) => { Registered = cls })
  return Registered
}

// 3. Drive process(). Note the shapes - these are what the real browser passes:
//      outputs      [ [Float32Array(128), ...one per channel] ]
//      parameters   { name: Float32Array }  length 1 = constant for the block,
//                                           length 128 = a-rate, one value per sample
const c = (v) => new Float32Array([v])
const render = (Processor, table, channels, blocks, spec) => {
  const p = new Processor()
  if (table) { p.port.onmessage({ data: table }) }   // however the processor receives state
  const out = []
  for (let b = 0; b < blocks; b++) {
    const outputs = [[]]
    for (let ch = 0; ch < channels; ch++) { outputs[0].push(new Float32Array(BLOCK)) }
    const parameters = buildParams(spec, b)          // constants and/or 128-long ramps
    const alive = p.process([], outputs, parameters) // false = processor is done
    for (let ch = 0; ch < channels; ch++) { out.push(...outputs[0][ch]) }
    if (!alive) { break }
  }
  return out
}
```

For superosc the wavetable arrives over the port, so `table` must be the same shape
`play/wavetable.js` builds: `{ wave, integral, totals, frameLen, count }`, with `integral`
the per-frame running sum and `totals[f]` each frame's cycle sum. A synthetic table is
fine — what matters is that before and after see *identical* input, not that it matches a
real `.WAV`.

## The null test

1. **Capture a reference before touching anything**, from the committed version:
   `git show HEAD:play/superosc-source.js > /tmp/before.js`, render every scenario, write
   the samples to a file. (Use `git show`, not `git stash` — stash touches the working tree
   and can collide with an unrelated stash the user already has.)
2. Make the change.
3. Re-render and compare **sample by sample, exact equality**. Report per scenario, with a
   non-zero-sample count so a silent scenario cannot pass by accident.

Keep the reference from *before the whole effort*, not from the previous step — then every
later round still proves the output matches the originally committed oscillator, rather
than drifting one bit-identical step at a time.

### Scenario coverage

The point is to hit every branch of the per-voice loop. For superosc that meant 20:
mono/unison=1, stereo/unison=7, unison=15 with amp+pan spread, a-rate `wt` sweep, a-rate
frequency+detune, hard sync, soft sync (the crossfade path), a-rate sync, crush (constant
and a-rate), pwm (constant and a-rate), formant (constant and a-rate), everything at once,
a very high note (aliasing path), sub-bass (small-span path), NaN unison/amp/pan fallbacks,
unison clamped above 16, and a not-yet-started processor.

For each toggle, test **constant and a-rate separately** — they take different code paths
(`param.length === 1` vs `128`), and a fast path added for one silently skips the other.

## Benchmarking: one variant per process

**Never load two versions of a processor in the same Node process.** The shared
`p.process(...)` call site goes megamorphic, deoptimises, and the numbers become garbage —
not noisy, *wrong*. In this repo it once reported a variant as 30% faster when it was
actually 3% slower, and inflated the baseline by 50%.

Run each variant in its own process (`FILE=... node -e "$SCRIPT"` in a shell loop), warm up
a few thousand blocks, then take the **median of 3** timed runs. Report as % of one core:

```
percentOfOneCore = renderMillis / (secondsOfAudioRendered * 1000) * 100
```

Per-voice cost against **one** core is the number that matters: Web Audio renders
everything on a single thread, so a machine's other cores contribute nothing.

Sanity-check a new benchmark by reproducing a previously recorded baseline before trusting
any delta from it.

## Gotchas

- **No backticks anywhere inside the worklet source string** — not even in a comment. It is
  a template literal; one backtick ends it and yields a `SyntaxError` at `addModule`. The
  same is true of `${`. Assert both are zero after editing.
- **Removing a `+ 0 * x` term is not always bit-identical.** `x + 0 === x` for every float
  except `-0` (where `-0 + 0` is `+0`). Numerically identical and `===`-equal, so a null
  test still passes — but reason about it rather than assuming.
- **`process()` returning `false` destroys the processor.** Model the start/stop gate
  params if the code under test uses them, or the render stops after one block.
- **The harness proves arithmetic, not scheduling.** It cannot tell you about real-thread
  deadlines, glitching under load, or musical quality. For audible-defect detection on the
  rendered output use `verifier-audio-wiring`; for tone and balance the user has to listen.
- Optimisation lesson already learned three times in `superosc-source.js`: that read loop is
  bound by **scattered array loads**, not arithmetic. Saving divides buys nothing; adding a
  branch in front of each load costs real time; hoisting one check over a *contiguous run*
  of loads wins big. Measure, don't reason — and see the comments in that file first.
