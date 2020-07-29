'use strict';
define((require) => {

  let evalParam = (value, step, beat) => {
    if (Array.isArray(value)) {
      let v = value[step % value.length]
      if (typeof v == 'function') { return evalParam(v, step, beat) }
      return v
    } else if (typeof value == 'function') {
      let v = value(step, beat)
      if (Array.isArray(v)) { return v }
      return evalParam(v, step, beat)
    } else if (typeof value == 'object') {
      let result = {}
      for (let k in value) {
        result[k] = evalParam(value[k], step, beat)
      }
      return result
    } else {
      return value
    }
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  assert(1, evalParam(1, 0, 0))
  assert(1/2, evalParam(1/2, 0, 0))
  assert(1, evalParam([1,2,3], 0, 0))
  assert(2, evalParam([1,2,3], 1, 0))
  assert(3, evalParam([1,2,3], 2, 0))
  assert(1, evalParam([1,2,3], 3, 0))
  assert(5, evalParam(() => 5, 0, 0))
  assert(5, evalParam((x,y) => y, 0, 5))
  assert([1,2], evalParam([()=>[1,2]], 0, 0))
  assert([3,4], evalParam([()=>[1,2],()=>[3,4]], 1, 0))
  assert({x:1}, evalParam({x:[1,2]}, 0, 0))
  assert({x:2}, evalParam({x:[1,2]}, 1, 1))
  assert('a', evalParam('a', 0, 0))
  assert('a', evalParam(['a','b'], 0, 0))
  assert('b', evalParam(['a','b'], 1, 1))

  console.log('Eval param tests complete')

  return evalParam
})
