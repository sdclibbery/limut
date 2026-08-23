---
name: verifier-audio-wiring
description: Verify audio-graph wiring changes (fx chains, connectable construction, node-function output) in limut by driving the running app in headless Chrome and inspecting the constructed Web Audio graph. Use when modifying play/player-fx.js, play/nodes/graph.js, play/effects/*, play/synth/bus.js, expression/connectOp.js, expression/connectableOps.js, or anything else whose effect is "the audio node graph wires up differently."
---

# Verifying limut audio-graph wiring

Headless Chrome has no speakers, but it still *renders* audio to a null sink — so two things are observable: the *constructed graph* (read back `players.getById('p1')._fx.chain`, walk node connections, etc.) and the *rendered samples* (via the app's master `AnalyserNode`, see "Detecting audible glitches numerically" below). For non-trivial wiring changes these are the only meaningful runtime evidence beyond the inline test suite — which doesn't cover audio-graph construction at all.

## What this skill verifies

- An `fx=` expression actually produces a wired `AudioNode` chain (not a scalar `0`, not a wrapped placeholder, not `undefined`).
- The fallback path in `player-fx.js`, `graph.js` (loop/mix), etc. runs when expected.
- Connectable operator output (`>>`, `+` on nodes, etc.) is a real audio node.
- Per-frame vs per-event scheduling produces the chain you expect (gain wraps with automated `.gain` vs static value).
- Clicks/crackles/discontinuities in the rendered output — numerically, via the analyser (below). This caught the gain-pool crackle that graph inspection alone could never show.

## What this skill cannot verify

- Whether the chain *sounds* musically right (tone, balance, perceptual quality) — for that the user has to listen in a real browser. But objectively-detectable defects (discontinuities, blasts, silence) ARE verifiable numerically.
- Anything that depends on virtual time — `system.audio.currentTime` advances in real wall-clock time, virtual-time doesn't help. Measurement runs take real seconds.

## The harness

Limut isn't trivially drivable: `updateCode` runs but no events fire unless the metronome loop ticks, and the metronome loop in `main.js` does `players.instances.forEach(p => p.play(p.getEventsForBeat(beat)))` — without that, no event reaches `play/synth/bus.js` → `connectToFxChain` → `createPlayerFxChain`, and `_fx.chain` stays undefined. So the harness has to replicate `main.js:tick` minimally.

**Don't try to use Chrome DevTools Protocol** (puppeteer, raw CDP via WebSocket). On Chrome 148 (headless=new) `Runtime.evaluate` does not reply on either the per-page WS or browser-WS-with-`Target.attachToTarget(flatten:true)` sessions. `Browser.getVersion` works, evaluation doesn't. Static HTML harness loaded via `--headless=new` with `--enable-logging=stderr --v=1` is the working path.

### Harness shape

Drop a file at `verify-<thing>.html` at the repo root, alongside `index.html`. Required ingredients:

1. **DOM stubs** — `console.js` and friends `document.getElementById(...)` at module load time. Include enough stub elements to avoid load-time TypeErrors:

   ```html
   <textarea id="console"></textarea>
   <div id="code-codemirror"></div>
   <canvas id="canvas"></canvas><canvas id="text-canvas"></canvas>
   <input id="main-amp-slider" type="range" min="0" max="2" step="0.01" value="1">
   <div id="vu-meter-l"></div><div id="vu-meter-r"></div>
   <div id="compressor-readout"></div><div id="beat-latency-readout"></div>
   <div id="visual-readout"></div><div id="beat-readout"></div>
   <div id="beat1-readout"></div><div id="beat2-readout"></div><div id="beat3-readout"></div>
   <div id="clock"></div>
   ```

2. **Force-load the node-function registrations.** A bare `require(['update-code'])` loads enough for parsing but *not* the modules that register `gain`, `delay`, effects, etc. via `addNodeFunction`. Without them, the gain-wrap fallback at `player-fx.js:102` throws `TypeError: vars.all(...).gain is not a function`. Include these explicitly:

   The `update-code` module exports `{parseCode, updateCode}` — it is **not** the function itself, so grab `const updateCode = uc.updateCode` (a bare `updateCode(src)` on the module object throws `updateCode is not a function`).

   ```js
   require(['update-code', 'player/players', 'play/system', 'metronome', 'play/main-bus',
            'play/nodes/nodes', 'play/nodes/graph', 'play/effects/effects',
            'expression/connectableOps', 'expression/connectOp'], (uc, players, system, metronome) => {
     const updateCode = uc.updateCode; … });
   ```

   **The require callback must NOT be an `async` function.** The bundled RequireJS (2.1.18) type-checks callbacks with `"[object Function]" === Object.prototype.toString.call(cb)`; an async function reports `[object AsyncFunction]`, so it is silently treated as a value export and **never invoked** — no error, no log, the page just stalls with an empty module registry. Use a plain function and put the async work in an inner IIFE: `function (uc, …) { (async () => { … })().catch(e => console.log('VERIFY: error', ''+e)) }`.

3. **Replicate `main.js:tick` minimally** — without this no events fire:

   ```js
   const tickLoop = () => {
     const now = system.timeNow();
     const beat = metronome.update(now);
     const beatTime = metronome.beatTime(now);
     if (beat) {
       Object.values(players.instances).forEach(p => {
         if (p) { try { p.play(p.getEventsForBeat(beat)); } catch (e) {} }
       });
     }
     system.frame(now, beatTime);
   };
   ```

   Pump it from a `setTimeout(r, 16)`-paced async loop. **Don't use `--virtual-time-budget`** — `system.timeNow()` reads `system.audio.currentTime` which is real wall clock and doesn't advance under virtual time, so the metronome stays at beat 0.

4. **Probe after letting the metronome tick.** A couple of seconds of real time = a few beats at default bpm = enough for at least one event to fire and `_fx` to populate.

   ```js
   const probe = (label) => {
     const p = players.getById('p1');
     const fx = p && p._fx;
     const describe = v => {
       if (v === undefined) return 'undefined';
       if (typeof v === 'number') return 'number:' + v;
       if (typeof v !== 'object') return typeof v;
       if (v instanceof AudioNode) return 'AudioNode:' + v.constructor.name;
       if (v instanceof AudioParam) return 'AudioParam';
       return 'object{' + Object.keys(v).slice(0,6).join(',') + '}';
     };
     console.log('VERIFY:', label, '| chain=', describe(fx && fx.chain),
                 '| hasFadeOutGain=', !!(fx && fx.fadeOutGain),
                 '| hasChainInput=', !!(fx && fx.chainInput));
   };
   ```

5. **Between cases, reset with `updateCode('')` and pump enough ticks** before the next `updateCode(src)` — otherwise the previous player/bus state leaks through the key-based fx-chain reuse in `bus.js`.

6. **Node-creation intercept probe** — to verify per-copy/per-band params (e.g. `parallel{}`/`multiband{}` building N distinct filters), monkeypatch the factory before `updateCode` and read the collected nodes' AudioParams later:

   ```js
   const filters = []
   const orig = system.audio.createBiquadFilter.bind(system.audio)
   system.audio.createBiquadFilter = (...a) => { const n = orig(...a); filters.push(n); return n }
   // later: filters.map(f => f.frequency.value)
   ```

   `AudioParam.value` reflects live automation (`setTargetAtTime` etc.), so sampling it twice ~1s apart in real time also proves a per-frame sweep is actually moving. Collected nodes with default param values (e.g. 350 Hz biquads) are orphans built outside the audible chain — treat them as a bug signal (lambda-valued args used to produce one per event via eager modifier evaluation; fixed by `evalModifiers` in player/eval-param.js).

7. **DSL preludes**: `bpf`, `lpf` and friends are not built in — they're lambdas from `lib/nodes.limut` (loaded by `include`). In a harness, define what you need inline (e.g. `set bpf = {freq, q:1} -> biquad{'bandpass', freq:freq, q:q}`) rather than relying on async `include` timing.

## Detecting audible glitches numerically

Headless Chrome renders the realtime `AudioContext` to a null sink, so the app's master analyser sees real rendered samples. To hunt clicks/crackles (proven on the June 2026 gain-pool crackle, which showed maxDelta 1.19 vs 0.0005 clean):

```js
system.analyser.fftSize = 32768                       // ~0.7s of history per grab
const buf = new Float32Array(32768)
// inside the tick loop, each frame:
system.analyser.getFloatTimeDomainData(buf)
for (let i = 1; i < buf.length; i++) {
  const d = Math.abs(buf[i] - buf[i-1])
  if (d > maxDelta) maxDelta = d
  if (d > 0.05) bigJumps++; else if (d > 0.02) smallJumps++
}
```

- Only deltas *within* one grab are valid (consecutive grabs overlap/gap at their boundary — but the loop above never crosses it).
- Always run a **scenario matrix** (suspect condition on/off × cofactor on/off) in one page load and compare relative numbers; absolute thresholds depend on signal content. A legit low-frequency signal has per-sample deltas ≈ `amplitude·2πf/sampleRate` — for the repro tones used here that's ~0.005, so >0.02 is a real discontinuity.
- Warm up ~2s after `updateCode` before measuring; drain ~1.5s with `updateCode('')` between scenarios. Repeat runs or shuffle scenario order before trusting a small count (~tens of samples over threshold can be one-off jank).
- Single-sample isolated blips that don't reproduce across runs are noise; real bugs at per-event rates produce thousands of over-threshold samples.

Useful knobs while bisecting:

- **Toggle pooling without reloading**: `limutNodePool.enabled = false` works mid-session — the patched `createGain` keeps running but `release()` no-ops and the pool drains, which is equivalent to `?nopool` for A/B within one page load. Clear `pool.nodes.length = 0` (and `pool.quarantine.length = 0`) between scenarios.
- **Attribute node creations to call sites**: wrap `system.audio.createGain` and bucket `new Error().stack` lines — instantly shows how many gains per event and from where (e.g. revealed `perFrameAmp` creates a second pooled gain per event because default `amp` is a function).
- **Bisect lifecycle resets**: replace `limutNodePool.release` with a copy controlled by flags (`doCancel`, `doValue`, per-site `kinds`) to isolate which reset write and which node kind causes an artifact.

**Caveat**: an `OfflineAudioContext` re-creation of the same call sequence (even with `suspend()`-exact op timing) can come back clean when the realtime app glitches — main-thread-vs-render-thread races (e.g. param writes applying before same-task disconnects) only exist in the realtime context. Test the real app, not a simulation, before concluding "no bug".

## Running the harness

`sh server.sh` must already be running (start it if not — check with
`curl -sf http://localhost:8000/ >/dev/null` or `lsof -i :8000` first). If it was
already running, leave it running when done; only kill a server you started
yourself. Then:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu \
  --autoplay-policy=no-user-gesture-required \
  --enable-logging=stderr --v=1 \
  --no-first-run --user-data-dir=/tmp/limut-verify-chrome \
  "http://localhost:8000/verify-<thing>.html" 2> /tmp/verify.log &
PID=$!; sleep 30; kill $PID 2>/dev/null
grep "INFO:CONSOLE" /tmp/verify.log | sed -E 's|.*CONSOLE[^"]*"||; s|", source:.*||'
```

**Always use a fresh `--user-data-dir`** (or delete the existing one) when changing JS source you care about. Chrome aggressively caches static assets between runs, and you *will* spend an hour confused by stale module state otherwise. `rm -rf /tmp/limut-verify-chrome` before the run, every time.

`--autoplay-policy=no-user-gesture-required` is required — without it `system.audio.state` is `suspended` and the metronome never advances.

## Hunting node leaks (liveness, not wiring)

"Is this node still alive / still rendering?" is a different question from "is it wired
right", and the wiring probes above answer it badly. Rules learned the hard way:

**Never hold tracked nodes in a strong `Map`/array.** A tracker that keeps references
*is* the leak while it runs, and worse, it silently poisons DevTools `queryObjects()` in
the real app — `queryObjects` returns anything retained by any reference, including the
instrumentation's. A session was spent chasing "3,952 leaked AudioWorkletNodes" that were
3,952 nodes held alive by the tracking Map. If the number you get back exactly equals the
number ever created, suspect your own tracker before believing the leak.

Track liveness with `WeakRef` + `FinalizationRegistry` instead:

```js
window.__wl = { created: 0, collected: 0 }
const reg = new FinalizationRegistry(() => { window.__wl.collected++ })
// ... reg.register(node, 1) at construction; survivors = created - collected
```

Run Chrome with `--js-flags=--expose-gc` and force collection properly — one `gc()` is not
enough, and FinalizationRegistry callbacks arrive asynchronously after it:

```js
for (let i = 0; i < 5; i++) { if (globalThis.gc) globalThis.gc(); await sleep(300) }
```

**Render capacity is not measurable here.** `AudioContext.renderCapacity` has never
shipped unflagged (see the comment at `play/system.js:36-50`), so audio-thread load can
only be read from the user's DevTools WebAudio panel. Node *liveness* is fully measurable
headlessly, so split the question: measure liveness yourself, ask the user for capacity.
Always get the **idle floor** (fresh page, Go with an empty editor) before calling any
capacity reading anomalous.

**Reverse-BFS from `destination` must be seeded from `system.vcaMainAmp`.** If you patch
`AudioNode.prototype.connect` from the console, the static tail
(`vcaMainAmp -> limiter -> destination`, wired at `play/system.js` module-load time) was
connected before your patch, so `destination` has zero recorded incoming edges and the
walk returns 0 no matter what is playing. Get the module via the AMD global
`requirejs('play/system')` — in Electron, bare `require` may be Node's.

**An edge map built from connect/disconnect is a live snapshot, not a history.**
`disconnect` removes edges, so a tiny post-Stop edge count is expected and healthy. Keep
cumulative creation counts as a separate tally, and never read a creation histogram as a
liveness measure.

**Patching a constructor loses its name.** `window.AudioWorkletNode = class extends X {}`
gives `constructor.name === ''` (named evaluation does not apply to member-expression
assignment), so instrumented nodes tally under an empty-string key. Use a named class:
`class TrackedAudioWorkletNode extends X {}`.

**AudioWorklet termination is the special case.** A native source dies on `stop()`. A
worklet node only dies when the render thread runs `process()` again and sees the `stop`
param — so it must be `start()`ed, and the `stop` param must actually be set. Verified in
both Chrome 148 and Electron 36: a node that is started and stopped is always collected,
even when disconnected in the same tick and even at 6,000 nodes in 10s. A node that is
**never started leaks permanently** (100% survival), because the not-yet-started guard
returns `true` forever. When testing a synth's teardown, cover: start+stop, never-started,
stopped-but-never-started, and stop-scheduled-before-start.

## Testing under Electron, not just Chrome

Some limut bugs are Electron-only (the ToDo records a superosc/keyboard oddity that
appears in Electron but not Firefox). Electron 36 ships a much older Chromium than a
current Chrome, so verify both before concluding an environment is clean. Drop a throwaway
main next to the real one and point it at the same harness URL:

```js
const {app, BrowserWindow} = require('electron')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('enable-exclusive-audio')          // mirror electron-main.js
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('js-flags', '--expose-gc')
app.on('ready', () => {
  const w = new BrowserWindow({ show: false })
  w.webContents.on('console-message', (...a) => {         // E36: (e, level, msg, line, src)
    const m = (a[1] && typeof a[1] === 'object' && 'message' in a[1]) ? a[1].message : a[2]
    if (typeof m === 'string' && m.startsWith('VERIFY:')) { console.log(m) }
  })
  w.loadURL('http://localhost:8000/verify-thing.html')
})
```

Run with `node_modules/.bin/electron verify-electron-main.js` (check the installed version
with `--version`; it can lag `package.json`). Delete the file afterwards with the harness.

## Editing a harness file

Build the harness with a single heredoc `cat > file <<'EOF'`. Patching it afterwards with
`str.split(marker)[0]` truncation is how you lose helper functions defined after the
marker — `;(async () => {` in particular matches the tick loop first. Rewrite the whole
file instead.


## Before/after evidence

For maximum confidence, add a one-line `console.log('DIAG: …', value)` at the decision site you're checking (e.g. just after `evalParamEvent` in `player-fx.js`), run the harness against the unfixed code, then again against the fixed code. The DIAG line shows what the evaluator actually returned, which is the load-bearing question — the probe just shows the downstream effect. Strip the DIAG before committing.

## Cleanup

The harness file is a verification artifact — delete it before committing. Same for any DIAG console.log inserted during the run. The verify-fx-style files belong in `/tmp` or the harness file at repo root that you remove after; don't ship them in the diff.

## Related

- For inline behaviour tests of pure functions: see the `headless-tests` skill (uses the existing `?test` URL-param flow against the real `index.html`).
- Architectural background on the predicates and chain construction: `audio-internals` skill — the "isConnectable vs isConnectableOrPlaceholder" and "`audiosynth` player flow" sections.
