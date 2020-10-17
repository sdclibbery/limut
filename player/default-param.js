'use strict';
define((require) => {

  let evalParam = (value, def) => {
    if (value === null || value === undefined || (typeof(value) == 'number' && isNaN(value))) {
      value = def
    }
    return value
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  assert(1, evalParam(1, 0))
  assert(0, evalParam(null, 0))
  assert(0, evalParam(undefined, 0))
  assert(1/2, evalParam(1/2, 0))
  assert(0, evalParam(0, 1))

  console.log('Default param tests complete')
  }

  return evalParam
})
