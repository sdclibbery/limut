# Limut

A browser-based live coding environment for music and visual performance. Users write a custom DSL to create audio players and WebGL visuals that update in real-time. No build step required.

## Running

```sh
sh server.sh   # starts Python HTTP server on port 8000
```

Open `http://localhost:8000` in a browser. URL params:
- `?test` — run in-browser unit tests (output in browser console)
- `?textarea` — use plain textarea editor instead of CodeMirror (mobile fallback)

## Module System

Uses AMD modules via bundled `require.js`. All modules use `define(function(require) { ... })`. There is no bundler, transpiler, or npm build step — plain ES6+ JS is served directly. The only npm dependency is Electron (for the optional desktop build).

## Code Architecture

```
index.html → require.js → main.js
```

`main.js` is the entry point: it wires together all subsystems and runs the `requestAnimationFrame` loop.

**Core flow:**
1. User edits DSL → `update-code.js` → `parse-line.js` dispatches to player/visual/var handlers
2. `metronome.js` ticks on each animation frame → players schedule audio events to Web Audio clock
3. `draw/system.js` renders WebGL visuals each frame

**Key directories:**
- `expression/` — DSL expression parser and evaluator (`parse-expression.js` is the main entry)
- `player/` — event scheduling, pattern playback, parameter evaluation
- `play/` — Web Audio synthesis engines and effects
- `play/synth/` — oscillators, FM, 808 emulation, samplers, etc.
- `play/effects/` — reverb, echo, chorus, flanger, phaser, filters
- `draw/` — WebGL rendering, shaders, sprites, text, scope display
- `functions/` — built-in DSL functions (time, rand, math, sliders, midi-knob)
- `preset/` — pre-built sound definitions loaded at startup

## Tests

Tests are inline in source files, gated behind a URL param check:

```js
if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  // test code
}
```

Run by opening `http://localhost:8000?test` and checking the browser console. There is no separate test runner.

### Running tests headlessly (from a shell)

Headless Chrome can run the test suite and forward `console.log` to stderr:

```sh
sh server.sh > /tmp/limut-server.log 2>&1 &       # start server in background
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu \
  --enable-logging=stderr --v=1 \
  --virtual-time-budget=30000 \
  "http://localhost:8000/?test" 2> /tmp/limut-test.log &
CHROME_PID=$!
sleep 25
kill $CHROME_PID 2>/dev/null
grep "INFO:CONSOLE" /tmp/limut-test.log \
  | sed -E 's|.*CONSOLE[^"]*"||; s|", source:.*||'
```

Notes:
- `--enable-logging=stderr --v=1` is what surfaces page `console.*` lines. Without it nothing is printed.
- `--virtual-time-budget=30000` advances Chrome's clock so async test bootstraps complete. With the default, only the first ~3 test files finish before the page is killed.
- Chrome won't exit on its own; kill the PID after sleeping long enough for tests to run.
- The `sed` strips Chrome's `[pid:tid:date:INFO:CONSOLE:line]` prefix and the trailing `, source: ...` so each test message is one clean line.
- A passing test file prints `"<Name> tests complete"`. There are ~48 such files; expect ~43 to report under headless. Look for any line that isn't `tests complete` and isn't `console.js (7)` (that's the empty-line spacer) — those are failures or load errors.
- The 5 `draw/*` modules (`shadercommon`, `shaders`, `texture`, `text`, `colour`) fail to load under plain headless because their WebGL deps aren't satisfied — their tests are skipped, not failing. To run them too, add `--use-gl=swiftshader` for software WebGL.
- Remember to kill the background server (`kill <pid>`) when done.

## DSL Reference

### Line types

```
p1 play X., amp=2, room=0.1     # define/update a player
v1 swirl 2, rate=1/6, zoom=2    # define/update a visual
set bpm=120, scale=major        # set global variables
set p1 amp+=1                   # override a player param
preset kick io808, amp=2        # define a named preset
include 'myfile.limut'          # load external file
```

Player/visual state persists across code updates — players are updated in-place.

### Audio player types

`play`, `drums`, `io808`, `wave`, `fm`, `multiwave`, `pwm`, `noise`, `sample`, `piano`, `audiosynth`, `pitchedperc`, `impulse`, `external`, `bus`

### Visual player types

`scope`, `scopefft`, `meter`, `readout`, `shadertoy`, `image`, `buffer`, `text`, `webcam`, `swirl`, `kal`, `clouds`, `lines`, `blob`, `stars`, `glow`, `lights`, `grid`, `bars`, `bits`, `xor`, `gradient`, `julia`, `blank`, `streetlight`

### Expression syntax

| Syntax | Meaning |
|---|---|
| `(0,2,4)` | chord — expands to multiple events |
| `[100:2000]` | range sweep over time |
| `[0:8]r` | random selection from range |
| `mxvmxvmv` | sample name sequence |
| `X...X...` | drum pattern (X=hit, .=rest) |
| `[0:8]l` | linear interpolation modifier |
| `[0:8]e` | exponential interpolation modifier |
| `[0:8]s` | stepped modifier |
| `{value}->expr` | lambda / user-defined function |
| `foo{3}` | call user-defined function with arg |

### Common parameters

`amp`, `vel`, `oct`, `dur`, `delay`, `room`, `lpf`, `hpf`, `fx`, `rate`, `zoom`, `fore`, `back`

### Global vars (set with `set`)

`bpm`, `scale`, `root`, `beat.readouts`, and others defined in `main-vars.js`

## Key Files

| File | Purpose |
|---|---|
| `main.js` | Entry point, animation loop, system wiring |
| `parse-line.js` | Top-level DSL line dispatcher |
| `update-code.js` | Parses multi-line code blocks |
| `expression/parse-expression.js` | Core expression evaluator |
| `player/player-types.js` | Registry of all player and visual types |
| `player/players.js` | Player instance registry |
| `player/eval-param.js` | Evaluates params at synthesis time |
| `metronome.js` | Beat/timing system |
| `vars.js` / `main-vars.js` | Global variable storage |
| `predefined-var-defs.js` | Built-in function definitions |
| `play/system.js` | Web Audio context setup |
| `draw/system.js` | WebGL context and render loop |
| `electron-main.js` | Electron desktop wrapper (adds serial/DMX) |

## Internals: Audio Node Graph & Lifecycle

### `_destructor` object

Every per-event audio context has `params._destructor` set on it before audio nodes are created. It tracks nodes that need cleanup:

- `destructor.stop(node)` — registers a node to be stopped when the event ends
- `destructor.disconnect(node)` — registers a node to be disconnected
- `destructor.destroy()` — called at event end; stops and disconnects all registered nodes

**For per-event players** (e.g. `audiosynth`), `_destructor` is set inside `envelope()` in `play/envelopes.js`.
**For persistent fx chains**, `_destructor` is set inside `createPlayerFxChain()` in `play/player-fx.js` (using the fx chain's own long-lived destructor).

A missing `_destructor` (`e._destructor is undefined`) means an audio node is being created in a context where lifecycle tracking hasn't been set up — e.g. during arithmetic/connectable evaluation in an `fx=` expression, or in test code that passes a bare `{}` event.

**`stop` vs `disconnect` — both matter, but differently:**
- **Source nodes** (`OscillatorNode`, `ConstantSourceNode`, `AudioBufferSourceNode`) need **both** `stop()` and `disconnect()`. A disconnected-but-not-stopped source node becomes silent but keeps consuming audio rendering CPU and is held in destructor lists, preventing GC. It will run until the tab closes.
- **Processing nodes** (`GainNode`, `StereoPannerNode`, filters, etc.) only need `disconnect()`. They have no running state; once disconnected from the graph they become inert.

**Safe guard pattern for source nodes** — stop immediately as fallback so nodes are never leaked:
```js
if (e && e._destructor) { e._destructor.stop(node) } else { node.stop() }
```

**Safe guard pattern for processing nodes** (used in `expression/connectOp.js`) — disconnect is sufficient:
```js
if (e && e._destructor) { e._destructor.disconnect(node) }
// No else needed: a disconnected GainNode etc. is inert with no running state to clean up
```

`node.stop()` with no argument stops at `currentTime`. If called before `start()` fires (e.g. if `start()` was scheduled in the future), the node produces no audio — safe and correct.

### Expression operator precedence

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

### AudioNode connect operator (`>>`)

Defined in `expression/connectOp.js`. Has `doNotEvalArgs=true` and `raw=true` — it receives raw AST nodes and evaluates them itself via `evalRecurse`. This allows it to build the Web Audio signal chain (`.connect()`) between nodes. Already guards `_destructor` usage at line 37.

### Connectable arithmetic (`connectableOps.js`)

When arithmetic operators (`+`, `*`, etc.) produce or consume an AudioNode, they dispatch to connectable variants in `expression/connectableOps.js`. `connectableAdd` (and similar) wrap non-AudioNode operands in a `ConstantSource` node via `vars.all().const(...)`. This means expressions like `1+osc.saw` cause a `constNode` to be created — so `_destructor` guards are needed in node creation functions too.

### Audio node creation (`play/nodes/source.js`)

Contains `osc`, `constNode`, and `sample` node functions. These are callable from DSL expressions (e.g. `osc.saw`, `sample:'foo'`). All three are source nodes — they need both `stop()` and `disconnect()`. Guard pattern: `if (e && e._destructor) { e._destructor.stop(node) } else { node.stop() }`. The `else { node.stop() }` is critical: without it, nodes created in a missing-destructor context (e.g. connectable arithmetic, tests) would be disconnected eventually but never stopped, leaking audio rendering resources.

### `audiosynth` player flow

1. `envelope(params)` → sets `params._destructor`, creates VCA gain node
2. `evalParamEvent(params.play, params)` → evaluates `play=` expression to get source AudioNode chain
3. If no `play=` param: `fxMixChain(params, vca)` — fx chain connects directly to VCA
4. If `play=` present: `waveEffects → effects → playChain → vca`, and `fxMixChain` wraps VCA with per-frame amp

`fxMixChain` (`play/effects/fxMixChain.js`) manages the persistent per-player fx chain, calling `createPlayerFxChain` (`play/player-fx.js`) which evaluates the `fx=` expression with its own long-lived destructor.

### DSL-defined effect functions (`lib/effects.limut`)

Many "effects" (`echo`, `pingpong`, `flanger`, `phaser`, `shifter`, `reverb`, `tape`, etc.) are **not JS code** — they are DSL functions defined via `set` in `lib/effects.limut`, loaded at startup via `include`. They are thin wrappers around lower-level node functions in `play/nodes/nodes.js`. For example, the DSL `echo` function wraps the `delay` node function. When debugging effect errors, check `lib/effects.limut` first to see how the DSL function maps parameters before passing them to the underlying node function.

### Audio node functions (`play/nodes/nodes.js`)

Contains JS implementations of node functions callable from DSL expressions: `delay`, `gain`, `shaper`, `panner`, `lfo`, `apf`, `series`, `convolver`, `idnode`, etc. These are registered via `addNodeFunction()` and looked up by name during expression evaluation. The `delay` node function creates a Web Audio `DelayNode` — its `max` parameter sets `maxDelayTime`, which the Web Audio API requires to be in range `(0, 180]`.

### Expression value ranges and Web Audio API constraints

DSL expressions can produce any numeric value, including 0 and negatives. Key examples:
- `[]n` (Perlin noise, no range) — raw noise from `eval-randoms.js:simpleNoise`, range roughly -0.3 to 1, **can be exactly 0** at integer beat boundaries
- `[]r` (random, no range) — 0 to 1 inclusive
- Arithmetic on these can amplify edge cases

Web Audio API `createDelay()` requires `maxDelayTime > 0`. When DSL expressions flow through to node creation parameters (e.g. `echo{[]n}` → DSL echo function → `delay{time, max:time*2}` → `createDelay(0)`), zero/negative values cause runtime errors. Guard with `Math.max(0.001, ...)` at the node creation boundary.

### Parameter evaluation flow (`play/eval-audio-params.js`)

Two evaluation modes, each with main/sub variants:
- **Per-event** (`evalMainParamEvent`, `evalSubParamEvent`): evaluates once when the audio event starts. Used for fixed values like `maxDelayTime`.
- **Per-frame** (`evalMainParamFrame`, `evalSubParamFrame`): sets up ongoing `setTargetAtTime` updates on an AudioParam, enabling time-varying parameters.

`evalPerEvent` returns the default only when the value is falsy AND not a number. **Zero is not treated as missing** — `typeof 0 !== 'number'` is false, so `0` passes through as a valid value rather than falling back to the default. This is correct for most params but means node creation code must handle 0 explicitly where the Web Audio API forbids it.

### `set` overrides and pattern timing (`player/standard.js`, `player/player.js`)

Player overrides (`set p1 amp=2`) are stored in `players.overrides` by `parse-line.js` and applied to events in `player.processEvents()` via `applyOverrides()`. This happens **after** the pattern has already generated events with their timing.

The `dur` param is special — it controls both **pattern timing** (when events are scheduled, how many fit per beat) and **envelope sustain** (how long a note sounds). Pattern timing reads `dur` from `result.params.dur` in `pattern/pattern.js:32`. For standard players, `player/standard.js` merges the `dur` override into the pattern params so it affects timing. To prevent double-application (which would corrupt compound overrides like `dur+=1`), `processEvents` in `player.js` skips the `dur` override for standard players (`player._standardPlayer = true`).

**Event generation pipeline for standard players:**
1. `standard.js` merges `dur` from `players.overrides` into pattern params
2. `pattern/pattern.js` generates events with correct timing and `event.dur` from timing math
3. Pattern copies non-dur params from `result.params` to events (line 44-46 skips `dur`, `_time`, `value`)
4. `player.getEventsForBeat()` adds `beat` info and computes `_time` from beat clock
5. `player.processEvents()` applies remaining overrides (excluding `dur` for standard players), expands chords, applies delay/stutter/swing

**Why `dur` needs special handling:** Other overridden params (like `amp`) are simply set on the event in step 5. But `dur` must be known at step 2 to generate correctly-timed events. If only applied at step 5, the pattern timing uses the old `dur` while the envelope uses the new one — notes sound shorter/longer but still fire at the old rate.
