---
name: headless-tests
description: Run the limut in-browser test suite from a shell using headless Chrome. Use when the user asks to run, check, or verify tests without opening a browser, or when validating a change touched testable code.
---

# Running limut tests headlessly

Tests are inline in source files, gated behind a `?test` URL param:

```js
if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  // test code
}
```

Open `http://localhost:8000?test` in a browser and look at the console — or run headlessly as below.

## The procedure

**Reuse an already-running server.** Before starting one, check whether the server
is already up (e.g. `curl -sf http://localhost:8000/ >/dev/null` or
`lsof -i :8000`). If it is, use it and **do not kill it when done** — the user is
likely relying on it. Only start your own server if none is running, and in that
case kill it afterwards.

```sh
# only if nothing is already listening on :8000
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

Kill the background server (`kill <pid>`) when done **only if you started it**. If
it was already running before you began, leave it running.

## Why each flag matters

- `--enable-logging=stderr --v=1` — surfaces page `console.*` lines. Without it nothing is printed.
- `--virtual-time-budget=30000` — advances Chrome's clock so async test bootstraps complete. Without this, only the first ~3 test files finish before the page is killed.
- Chrome won't exit on its own; kill the PID after sleeping long enough for tests to run.
- The `sed` strips Chrome's `[pid:tid:date:INFO:CONSOLE:line]` prefix and the trailing `, source: ...` so each test message is one clean line.

## Interpreting output

- **Fastest signal: the summary line.** `test-summary.js` (loaded from `index.html`'s
  `<head>`, active only under `?test`) tallies every module and prints one line once
  output goes quiet: `✓ ALL TESTS PASSED  N modules complete`, or
  `✗ K FAILURES in M modules` followed by one `• <file>  ×count` line per offending
  module. Grep for it to get a verdict without reading every line:

  ```sh
  grep "INFO:CONSOLE" /tmp/limut-test.log \
    | sed -E 's|.*CONSOLE[^"]*"||; s|", source:.*||' \
    | grep -iE "PASSED|FAILURE|•"
  ```

  The `%c` styling and CSS strings are only for a real browser's DevTools (colour);
  in the headless capture they show as literal text after the message — ignore them.
  If the summary line is **absent**, the run was cut short (budget too small, or the
  page hung before the debounce fired) — treat that as inconclusive, not a pass.
- A passing test file prints `"<Name> tests complete"`.
- There are ~48 such files; expect ~43 to report under plain headless.
- Look for any line that is **not** `tests complete` and **not** `console.js (7)` (that's the empty-line spacer) — those are failures or load errors.
- `Assertion failed` traces only report the assert helper's line (e.g. `CONSOLE:202`), not the failing test line. To locate one, temporarily replace the suspect asserts with distinctive `console.log` markers and re-run.
- **Async test IIFEs interleave across modules.** An `(async () => {...})()` test block suspends at each `await`, and other modules' async test blocks (and later module factories) run in between — shared mutable state like `sections.active` gets clobbered nondeterministically. All async tests that touch the same shared state must be sequenced inside ONE IIFE (see the sections/section-blocks IIFE in `update-code.js`), and should end with `.catch(e => console.trace(...))` so a mid-test throw is reported instead of vanishing.
- **Async IIFE console output does not surface in the full-app headless run.** Failures (and any `console.log`) from inside async test IIFEs never appear in the `?test` capture of the full app, even though the tests run — a real browser shows them, and a minimal harness page that requires just the module under test (plus `<textarea id="console">`) surfaces them too. When touching async tests, verify with such a harness or in a real browser; don't trust a clean full-app headless run alone.
- Test blocks within a file share mutable state. In `parse-expression.js` the scratch vars `e`/`p`/`v` are reused across hundreds of asserts — reassigning `e` in an inserted test breaks later tests that assume e.g. `e.count === 0` (wrap new tests in `{ let e2 = ... }`). Per-frame callbacks also leak via `system.queued` (reset before and after). When failures appear in tests you didn't touch, run the suite with your changes stashed (`git stash`) to tell real regressions from state leakage.

## Running the WebGL/draw tests too

The 5 `draw/*` modules (`shadercommon`, `shaders`, `texture`, `text`, `colour`) fail to load under plain headless because their WebGL deps aren't satisfied — their tests are skipped, not failing. To include them, add `--use-gl=swiftshader` for software WebGL:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --use-gl=swiftshader \
  --enable-logging=stderr --v=1 \
  --virtual-time-budget=30000 \
  "http://localhost:8000/?test" 2> /tmp/limut-test.log &
```

## Driving the whole app (UI behaviour, not just the test suite)

For behaviour that only exists in the running app — DOM readouts, buttons, section transitions over real beats — drive the real page rather than the `?test` suite. Confirmed working 2026-08-04:

```sh
python3 -c "s=open('index.html').read(); open('verify-app.html','w').write(s.replace('</body>','<script src=\"/verify-driver.js\"></script>\n</body>'))"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader \
  --autoplay-policy=no-user-gesture-required --enable-logging=stderr --v=1 \
  "http://localhost:8000/verify-app.html?nosave" 2> /tmp/verify.log &
PID=$!; sleep 30; kill $PID 2>/dev/null
grep "CONSOLE" /tmp/verify.log | sed -E 's|.*CONSOLE[^"]*"||; s|", source:.*||'
```

- **Don't iframe `/index.html` from a harness page.** The parent frame's `setTimeout`/`setInterval` (and its console capture) go dead once the app loads in a child frame: the first synchronous log appears and then nothing, so an async driver silently stalls at its first `await` — with no error to explain it. Appending the driver to a *copy* of index.html sidesteps this entirely; async `console.log` from inside the app's own frame **is** captured (unlike the `?test` async-IIFE case above).
- `--use-angle=swiftshader` now needs `--enable-unsafe-swiftshader` too (software WebGL fallback was deprecated). Without working WebGL2 the app's `alert()` blocks the whole renderer and nothing runs.
- Driver shape: poll for `document.querySelector('.CodeMirror')` + `window.go`, wait ~2.5s for presets/includes, then `cmEl.CodeMirror.setValue(src)` + `window.go()` and read DOM (`#section-readout`, `#section-buttons`, …). Simulate input with real events (`el.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true}))`); `dispatchEvent` returning `false` proves the handler called `preventDefault`.
- Use a fast `set bpm=600`, and **poll for the state you want** (`while readout doesn't start with 'contrast'`) instead of sleeping a computed number of beats — rAF pacing is irregular under headless and a whole section can elapse inside one `wait()`, which reads as a failure that isn't one.
- **`include` what the code under test uses, and give it its own `go()` first.** The DSL lines you drive with are not the app's default environment: `lib/visual.limut` (`noise2`, `fbm2`, `perlin*`, …) and the rest of `lib/` are only there if the driver includes them. A missing include does not error — an unresolved name in a `px` chain const-wraps into a uniform, so the canvas comes back flat white or flat black and reads exactly like a broken shader. Set `include 'lib/visual.limut'` alone, `go()`, wait ~3s for the fetch, then prepend the same line to each test source.
- **Reading the canvas back**: `gl.readPixels` returns zeros unless the context was made with `preserveDrawingBuffer`, so patch `HTMLCanvasElement.prototype.getContext` at the top of the driver (before the app's modules load) to force it on for `webgl`/`webgl2`, and keep the original function to fetch the context yourself later. The main canvas is `#canvas`; `#text-canvas` is a second one, so `querySelector('canvas')` is ambiguous — ask for it by id. Comparing two buffers byte for byte is the strongest verification available here: an equivalence render (the same picture built two ways) either differs in 0 bytes or it does not.
- **Multi-line output**: a `console.log` containing newlines arrives as several CONSOLE records, so a `grep` over the log keeps only the first line. Print long dumps (a shader source, a table) one line at a time with a fixed prefix and grep for that.
- Delete `verify-app.html` / `verify-driver.js` afterwards; they are verification artifacts, not part of the diff.

## When adding behaviour

Write or update an inline test alongside the code whenever it's reasonably testable — the inline test blocks are cheap to extend and catch regressions early. There is no separate test runner.
