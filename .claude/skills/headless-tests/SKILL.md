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

## When adding behaviour

Write or update an inline test alongside the code whenever it's reasonably testable — the inline test blocks are cheap to extend and catch regressions early. There is no separate test runner.
