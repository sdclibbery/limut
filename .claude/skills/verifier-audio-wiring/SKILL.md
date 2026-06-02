---
name: verifier-audio-wiring
description: Verify audio-graph wiring changes (fx chains, connectable construction, node-function output) in limut by driving the running app in headless Chrome and inspecting the constructed Web Audio graph. Use when modifying play/player-fx.js, play/nodes/graph.js, play/effects/*, play/synth/bus.js, expression/connectOp.js, expression/connectableOps.js, or anything else whose effect is "the audio node graph wires up differently."
---

# Verifying limut audio-graph wiring

Audio output is unobservable in headless Chrome (no speakers, no recording). But the *constructed graph* is observable: after driving the app's `updateCode` path, you can read back `players.getById('p1')._fx.chain`, walk node connections, etc. For non-trivial wiring changes this is the only meaningful runtime evidence beyond the inline test suite — which doesn't cover audio-graph construction at all.

## What this skill verifies

- An `fx=` expression actually produces a wired `AudioNode` chain (not a scalar `0`, not a wrapped placeholder, not `undefined`).
- The fallback path in `player-fx.js`, `graph.js` (loop/mix), etc. runs when expected.
- Connectable operator output (`>>`, `+` on nodes, etc.) is a real audio node.
- Per-frame vs per-event scheduling produces the chain you expect (gain wraps with automated `.gain` vs static value).

## What this skill cannot verify

- Whether the chain actually *sounds* right — headless Chrome has no audio output. For tonal/perceptual checks, the user has to listen in a real browser.
- Anything that depends on real-time audio processing (envelope shapes, filter sweeps) — `system.audio.currentTime` advances in real wall-clock time, virtual-time doesn't help.

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

## Running the harness

`sh server.sh` must already be running (start it if not). Then:

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

## Before/after evidence

For maximum confidence, add a one-line `console.log('DIAG: …', value)` at the decision site you're checking (e.g. just after `evalParamEvent` in `player-fx.js`), run the harness against the unfixed code, then again against the fixed code. The DIAG line shows what the evaluator actually returned, which is the load-bearing question — the probe just shows the downstream effect. Strip the DIAG before committing.

## Cleanup

The harness file is a verification artifact — delete it before committing. Same for any DIAG console.log inserted during the run. The verify-fx-style files belong in `/tmp` or the harness file at repo root that you remove after; don't ship them in the diff.

## Related

- For inline behaviour tests of pure functions: see the `headless-tests` skill (uses the existing `?test` URL-param flow against the real `index.html`).
- Architectural background on the predicates and chain construction: `audio-internals` skill — the "isConnectable vs isConnectableOrPlaceholder" and "`audiosynth` player flow" sections.
