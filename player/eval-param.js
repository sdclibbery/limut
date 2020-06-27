define((require) => {

  let evalParam = (value, def, count) => {
    if (value === null || value === undefined) {
      value = def
    }
    if (Array.isArray(value)) {
      return value[count % value.length]
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
  assert(0, evalParam(null, 0, 0))
  assert(0, evalParam(undefined, 0, 0))
  assert(1/2, evalParam(1/2, 0, 0))
  assert(0, evalParam(0, 1, 0))
  assert(1, evalParam([1,2,3], 0, 0))
  assert(2, evalParam([1,2,3], 0, 1))
  assert(3, evalParam([1,2,3], 0, 2))
  assert(1, evalParam([1,2,3], 0, 3))
//  assert(5, evalParam(() => 5, 0, 0)())

  console.log('Eval param tests complete')

  return evalParam
})
