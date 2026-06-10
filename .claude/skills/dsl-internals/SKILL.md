---
name: dsl-internals
description: Internals of the limut DSL parser, lambda/user-function machinery, player overrides, and pattern timing. Use when modifying anything under expression/ (especially parse-expression.js, parse-var.js, parse-map.js), player/callstack.js, player/standard.js, player/player.js, parse-line.js, or pattern/pattern.js — or when debugging issues with lambdas/user-defined functions, `set` overrides not taking effect, `dur` timing oddities, or chord/stutter/delay expansion.
---

# limut DSL internals

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

## User-defined functions / lambdas

Files: `expression/parse-expression.js`, `expression/parse-var.js`, `player/callstack.js`.

DSL lambda syntax: `{args}->body`. Eg `{value}->value*2`, `{x,y}->x+y`, `{x:3}->x^2` (default arg). The parser sees `{`, parses a map, then checks for `->` — if present, treats the map's keys as argument names and parses the body.

Keyless map values get keys `value`, `value1`, `value2`, etc. (see `expression/parse-map.js`). So `{i}->...` declares one positional arg `i`; calling `f{3}` passes `{value: 3}` and the body can reference `i` by name or `value` by position.

### Parsed lambda is a wrapper function

(`parse-expression.js`, lambda branch of `expression`):

```js
let userDefinedFunctionWrapper = (e,b,er,args) => {
  // aliases keyless slots (value, value1, ...) onto declared arg names in place
  pushCallContext(args)
  let r = er(body,e,b)
  popCallContext()
  return r
}
```

With flags `.isUserFunction = true`, `.isVarFunction = true`, `.isNormalCallFunction = true`, `.passCallsiteId = true`, `.dontEvalArgs = true`.

### How DSL-level calls bind args (three paths)

A call like `f{3}` reaches the wrapper differently depending on what `f` is:

1. **Lambda literal**: `({v}->v*2){3}` — `addModifiers` attaches `{value:3}` as `.modifiers` on the wrapper itself; `evalFunctionWithModifiers` (player/eval-param.js) evaluates the modifiers and passes them as the wrapper's 4th arg.
2. **Named var**: `foo{3}` where `set foo={v}->...` — `parseVarLookup` (parse-var.js) sees `dontEvalArgs` and passes the **raw unevaluated** args plus a `__functionContext` callsite id, calling `vr(event,b,evalRecurse,modifiers)`.
3. **Lambda held in a function arg** (higher-order): `{f}->f{3}` or via inherited args from an enclosing lambda — resolved by `userFunctionArgumentLookup` / `inheritedLookup` (parse-var.js). These receive the **evaluated** mods as their 4th param and invoke `isUserFunction` values with them, tagging `mods.__functionContext` with a callsite id. (Before 2026-06 they ignored the 4th param and called the wrapper bare via `er(value,e,b)` — args were evaluated then silently dropped, so every param in the body was `undefined`. Symptom: `parallel{}`/`multiband{}` copies all collapsing to the same value when the chain lambda was called through a wrapper function.)

Memoisation (`evalParamValueWithMemoisation`) keys on the function object, the event (WeakMap), and `options + beat + getCallTreeString()`. The call-tree string concatenates `__functionContext` ids up the chain — that's the only thing distinguishing `f{3}+f{4}` at the same event/beat, which is why every call path must supply a callsite id. Node functions (`parallel`, `series`, `multiband`) additionally clone the event per copy so memoisation can't collapse copies.

### Per-frame evaluation inside lambda bodies

`doPerFrame` (play/eval-audio-params.js) snapshots `getCallTree()` when an audio param is set up, and `setCallTree`/`clearCallTree` brackets each per-frame re-evaluation. This is how a frame-varying param inside a lambda body (e.g. `bpf{[1/2:2]l4@f*(i+1)*50}`) still sees `i` on every frame: the pushed call contexts are captured at construction time.

### Eager modifier evaluation and lambda-valued args

`evalFunctionWithModifiers` evaluates `value.modifiers` before calling the function (needed for the time-modifier keys `time`/`per`/`step`/`overrides`, for chord-in-args expansion, and for the lambda-literal call path). But top-level modifier values flagged `isUserFunction` are **split out and reattached unevaluated** (`evalModifiers`, player/eval-param.js) — calling them bare would eval their body with no call context (orphan node chain per event, spurious `log{}` prints), and every callee that takes a lambda wants the raw function anyway (`dontEvalArgs` callees overwrite with raw args; node functions branch on `callback.isUserFunction`; `userFunctionArgumentLookup` invokes `isUserFunction` values itself). Limitations: a lambda nested inside a map-valued arg, or a *named* lambda passed by reference (`parallel{chain, 8}` — which doesn't work as a per-copy callback anyway), still gets called bare.

### Calling a lambda from JS code

(e.g. inside `expandStutter` to pass an index per event):

```js
let result = wrapper(event, event.count, evalParamFrame, {value: i})
```

- Arg name `i` is looked up first; if not found, falls back to positional `value`/`value1`/etc.
- `args` values are passed as-is; the wrapper just pushes them onto the call context.
- If the body is a map literal (e.g. `{oct:2+i}`), `er(body,e,b)` evaluates each map value, yielding `{oct: 5}` for `i=3`. That return value can be fed straight into `applyOverridesInPlace`.

### Args flow via callstack, not closure

(`player/callstack.js`): references to lambda args inside the body become `userFunctionArgumentLookup` (own args, current frame only) or `inheritedLookup` (enclosing lambdas' args, walks the chain via `findInCallChainByKey`) in `parse-var.js`, which read from the call context at eval time. This is why nested lambda calls work and why `pushCallContext`/`popCallContext` bracket each invocation.

`unPushCallContext`/`unPopCallContext` exist so that when an arg's *value* is itself an expression captured from an outer scope, evaluating that value temporarily steps out of the current frame so its own free variables resolve in the right scope.

## `evalParamFrame` options

`evalParamFrame(value, event, beat, options)` where `options` controls evaluation:

- **default (no options)**: full evaluation — functions called, objects iterated and each field evaluated via evalRecurse, arrays mapped and flattened.
- **`{evalToObjectOrPrimitive: true}`**: object fields pass through *unevaluated*. Used when you want to inspect the map structure (e.g. find subparams) without forcing evaluation. The `stutter` and `delay` param handlers use this to access `.dur`, `.add`, etc. as raw expressions.
- **`{withInterval: true}`**: wraps per-frame results with their interval metadata; used by per-frame audio param scheduling.
- **`{expandingChords: true}`**: returns `0` (a chord-slot placeholder) for any value marked `_chordPlaceholder` — node functions, node-valued vars, and `this.*` lookups — so chord expansion can detect array structure without prematurely building audio nodes or realising this-references. Set only by `player/expand-chords.js`. (Formerly `ignoreThisVars`; the flag it gates was formerly `_thisVar`.)

## `set` overrides and pattern timing

Files: `player/standard.js`, `player/player.js`.

Player overrides (`set p1 amp=2`) are stored in `players.overrides` by `parse-line.js` and applied to events in `player.processEvents()` via `applyOverrides()`. This happens **after** the pattern has already generated events with their timing.

### Why `dur` is special

The `dur` param controls both **pattern timing** (when events are scheduled, how many fit per beat) and **envelope sustain** (how long a note sounds). Pattern timing reads `dur` from `result.params.dur` in `pattern/pattern.js:32`.

For standard players, `player/standard.js` merges the `dur` override into the pattern params so it affects timing. To prevent double-application (which would corrupt compound overrides like `dur+=1`), `processEvents` in `player.js` skips the `dur` override for standard players (`player._standardPlayer = true`).

### Event generation pipeline for standard players

1. `standard.js` merges `dur` from `players.overrides` into pattern params
2. `pattern/pattern.js` generates events with correct timing and `event.dur` from timing math
3. Pattern copies non-dur params from `result.params` to events (line 44-46 skips `dur`, `_time`, `value`)
4. `player.getEventsForBeat()` adds `beat` info and computes `_time` from beat clock
5. `player.processEvents()` applies remaining overrides (excluding `dur` for standard players), expands chords, applies delay/stutter/swing

### Why `dur` needs special handling

Other overridden params (like `amp`) are simply set on the event in step 5. But `dur` must be known at step 2 to generate correctly-timed events. If only applied at step 5, the pattern timing uses the old `dur` while the envelope uses the new one — notes sound shorter/longer but still fire at the old rate.
