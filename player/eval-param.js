define((require) => {

  let evalParam = (value, def) => {
    if (Array.isArray(value)) { return value }
    if (typeof value == 'number') { return value }
    if (typeof value == 'function') { return value }
    let result = Function('"use strict";return (' + value + ')')()
    if (result === null || result === undefined) { return def }
    return result
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  assert(1, evalParam(1, 0))
  assert(1, evalParam('1', 0))
  assert(0, evalParam(null, 0))
  assert(0, evalParam(undefined, 0))
  assert(1/2, evalParam('1/2', 0))
  assert(3, evalParam(' 1 + 2 ', 0))
  assert(0, evalParam(0, 1))
  assert(0, evalParam('0', 1))
  assert(0, evalParam('1-1', 1))
  assert([1,2,3], evalParam('[1,2,3]', 0))
  assert([1,2,3], evalParam([1,2,3], 0))
  assert(5, evalParam(() => 5, 0)())

  console.log('Eval param tests complete')

  return evalParam
})
