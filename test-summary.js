'use strict'
// Colourised pass/fail summary for the inline test suite.
//
// This is a plain <script> (NOT an AMD module) loaded from index.html's <head>
// so it runs before require.js pulls in any test module. Test modules run their
// asserts as they load, reporting failures via console.trace / console.assert
// and logging "<Name> tests complete" when a module finishes. We wrap those
// console methods to tally results, then print one colourised summary once the
// suite goes quiet, so you can tell at a glance whether everything passed
// without scrolling back through every module's output.
;(function () {
  if ((new URLSearchParams(window.location.search)).get('test') === null) { return }

  let failures = []   // { file, line }
  let completed = []  // module names, from "... tests complete" logs
  let printed = false
  let timer = null
  let DEBOUNCE_MS = 200 // print once output has been quiet this long (covers async tests)

  let orig = {
    log: console.log.bind(console),
    trace: console.trace.bind(console),
    assert: console.assert.bind(console),
  }

  // Best-effort source location of an assertion, skipping this file's own frames.
  // (console.trace fires inside each module's assert helper, so this pins the
  // failing module's file even when the line is the helper's.)
  let locate = () => {
    let stack = (new Error()).stack || ''
    let m = stack.split('\n')
      .map((l) => l.match(/(?:https?:\/\/[^/]+\/)?([\w./-]+\.js):(\d+)(?::\d+)?/))
      .find((m) => m && !/(?:^|\/)test-summary\.js$/.test(m[1]))
    return m ? { file: m[1], line: m[2] } : { file: '?', line: '?' }
  }

  let schedule = () => {
    if (printed) { return }
    if (timer) { clearTimeout(timer) }
    timer = setTimeout(print, DEBOUNCE_MS)
  }

  let print = () => {
    if (printed) { return }
    printed = true
    let nPass = completed.length
    let nFail = failures.length
    let byFile = {}
    failures.forEach((f) => { byFile[f.file] = (byFile[f.file] || 0) + 1 })
    let files = Object.keys(byFile)

    orig.log('\n───── LIMUT TEST SUMMARY ─────')
    if (nFail === 0) {
      orig.log(
        '%c ✓ ALL TESTS PASSED %c ' + nPass + ' module' + (nPass === 1 ? '' : 's') + ' complete',
        'color:#fff;background:#1a7f37;font-weight:bold;padding:2px 8px;border-radius:3px;font-size:13px',
        'color:#1a7f37;font-weight:bold')
    } else {
      orig.log(
        '%c ✗ ' + nFail + ' FAILURE' + (nFail === 1 ? '' : 'S') +
          ' in ' + files.length + ' module' + (files.length === 1 ? '' : 's') +
          ' %c\n' + nPass + ' module' + (nPass === 1 ? '' : 's') + ' complete',
        'color:#fff;background:#cf222e;font-weight:bold;padding:2px 8px;border-radius:3px;font-size:13px',
        'color:#cf222e;font-weight:bold')
      files.forEach((file) => {
        orig.log('%c   • ' + file + (byFile[file] > 1 ? '  ×' + byFile[file] : ''), 'color:#cf222e')
      })
    }
    orig.log('────────────────────────────────\n')
  }

  console.trace = function (...args) {
    failures.push(locate())
    orig.trace(...args)
    schedule()
  }
  console.assert = function (cond, ...args) {
    if (!cond) { failures.push(locate()) }
    orig.assert(cond, ...args)
    schedule()
  }
  console.log = function (...args) {
    orig.log(...args)
    if (typeof args[0] === 'string' && /tests complete\s*$/.test(args[0])) {
      completed.push(args[0].replace(/\s*tests complete\s*$/, ''))
      schedule()
    }
  }

  schedule() // guarantee a summary even if nothing logs at all
  window.limutTestSummary = { print: print, failures: failures, completed: completed }
})()
