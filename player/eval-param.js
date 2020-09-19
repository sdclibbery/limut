'use strict';
define((require) => {

  let evalParamNow = (value, step, beat) => {
    if (Array.isArray(value)) {
      let v = value[step % value.length]
      if (typeof v == 'function') { return evalParamNow(v, step, beat) }
      return v
    } else if (typeof value == 'function') {
      let v = value(step, beat)
      if (Array.isArray(v)) { return v }
      return evalParamNow(v, step, beat)
    } else if (typeof value == 'object') {
      let result = {}
      for (let k in value) {
        result[k] = evalParamNow(value[k], step, beat)
      }
      return result
    } else {
      return value
    }
  }

  let evalParamFrame = (value, step, beat) => {
    return evalParamNow(value, step, beat)
  }

  let evalParamEvent = (value, step, beat) => {
    if (value !== undefined && value.interval === 'frame') { return value }
    return evalParamNow(value, step, beat)
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  assert(undefined, evalParamEvent(undefined, 0, 0))
  assert(1, evalParamEvent(1, 0, 0))
  assert(1/2, evalParamEvent(1/2, 0, 0))
  assert(1, evalParamEvent([1,2,3], 0, 0))
  assert(2, evalParamEvent([1,2,3], 1, 0))
  assert(3, evalParamEvent([1,2,3], 2, 0))
  assert(1, evalParamEvent([1,2,3], 3, 0))
  assert(5, evalParamEvent(() => 5, 0, 0))
  assert(5, evalParamEvent((x,y) => y, 0, 5))
  assert([1,2], evalParamEvent([()=>[1,2]], 0, 0))
  assert([3,4], evalParamEvent([()=>[1,2],()=>[3,4]], 1, 0))
  assert({x:1}, evalParamEvent({x:[1,2]}, 0, 0))
  assert({x:2}, evalParamEvent({x:[1,2]}, 1, 1))
  assert('a', evalParamEvent('a', 0, 0))
  assert('a', evalParamEvent(['a','b'], 0, 0))
  assert('b', evalParamEvent(['a','b'], 1, 1))

  let perFrameValue = () => 3
  perFrameValue.interval= 'frame'
  let perEventValue = () => 4
  perEventValue.interval= 'event'

  assert(1, evalParamFrame(1, 0, 0))
  assert(perFrameValue, evalParamEvent(perFrameValue, 0, 0))
  assert(3, evalParamFrame(perFrameValue, 0, 0))
  assert(1, evalParamFrame(1, 0, 0))
  assert(4, evalParamEvent(perEventValue, 0, 0))
  assert(4, evalParamFrame(perEventValue, 0, 0))

  console.log('Eval param tests complete')

  return {
    evalParamEvent:evalParamEvent,
    evalParamFrame:evalParamFrame,
  }

})
