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

Remember to kill the background server (`kill <pid>`) when done.

## Why each flag matters

- `--enable-logging=stderr --v=1` — surfaces page `console.*` lines. Without it nothing is printed.
- `--virtual-time-budget=30000` — advances Chrome's clock so async test bootstraps complete. Without this, only the first ~3 test files finish before the page is killed.
- Chrome won't exit on its own; kill the PID after sleeping long enough for tests to run.
- The `sed` strips Chrome's `[pid:tid:date:INFO:CONSOLE:line]` prefix and the trailing `, source: ...` so each test message is one clean line.

## Interpreting output

- A passing test file prints `"<Name> tests complete"`.
- There are ~48 such files; expect ~43 to report under plain headless.
- Look for any line that is **not** `tests complete` and **not** `console.js (7)` (that's the empty-line spacer) — those are failures or load errors.

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
