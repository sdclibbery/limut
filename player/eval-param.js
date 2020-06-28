define((require) => {

  let evalParam = (value, step, beat) => {
    if (Array.isArray(value)) {
      return value[step % value.length]
    } else if (typeof value == 'function') {
      return value(beat)
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
  assert(5, evalParam((x) => x, 0, 5))

  console.log('Eval param tests complete')

  return evalParam
})
