# Limut

A browser-based live coding environment for music and visual performance. Users write a custom DSL to create audio players and WebGL visuals that update in real-time. No build step required.

## Running

```sh
sh server.sh   # starts Python HTTP server on port 8000
```

Open `http://localhost:8000` in a browser. URL params:
- `?test` — run in-browser unit tests (output in browser console)
- `?nopool` — disable GainNode pooling (`play/node-pool.js`) for A/B comparison; pool stats via `limutNodePool.stats()` in the console

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

When adding or changing behavior, write or update tests alongside the code whenever it's reasonably testable — the inline test blocks are cheap to extend and catch regressions early.

Tests are inline in source files, gated behind a URL param check:

```js
if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  // test code
}
```

Run by opening `http://localhost:8000?test` and checking the browser console. There is no separate test runner.

To run tests from a shell via headless Chrome, see the `headless-tests` skill.

For audio-graph wiring changes (fx chains, connectable construction, node-function output), the inline tests don't cover graph construction. Use the `verifier-audio-wiring` skill to drive the running app in headless Chrome and inspect the constructed Web Audio graph.

## Documentation

User-facing DSL docs live in `index.html` (the in-app reference panel). When you add, change, or remove a DSL feature — new params, subparams, player types, expression syntax, etc. — update the matching section in `index.html` so the docs stay in sync with the code.

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

## Internals

Deeper implementation details are split into two skills; invoke them when working in the relevant area:

- **`audio-internals`** — `_destructor` lifecycle, source vs processing nodes, `>>` operator, connectable arithmetic, audio node creation guards, `audiosynth` flow, DSL-defined effects, Web Audio API constraints, `evalParamFrame` modes. Use when editing `play/`, `expression/connectOp.js`, or `expression/connectableOps.js`.
- **`dsl-internals`** — expression operator precedence, lambda/user-defined function machinery (callstack, `pushCallContext`), `set` overrides and the `dur`/pattern-timing special case. Use when editing `expression/`, `player/`, `parse-line.js`, or `pattern/`.
