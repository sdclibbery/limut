'use strict';
define((require) => {
  require('player/expression/eval')

  let evalParamNow = (evalParam, value, step, beat, stopAtTuple) => {
    if (Array.isArray(value)) {
      let v = value[step % value.length]
      if (typeof v == 'function') {
        return evalParam(v, step, beat)
      }
      return v
    } else if (typeof value == 'function') {
      let v = value(step, beat)
      if (Array.isArray(v)) {
        if (stopAtTuple) { return v.map(x=>evalParamEvent(x, step, beat)) }
        return v.map(e => evalParam(e, step, beat))
      }
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

  let evalParamFrame = (value, step, beat) => {
    return evalParamNow(evalParamFrame, value, step, beat)
  }

  let evalParamEvent = (value, step, beat) => {
    if (!!value && value.interval === 'frame') { return value }
    return evalParamNow(evalParamEvent, value, step, beat)
  }

  let evalParamToTuple = (value, step, beat) => {
    return evalParamNow(evalParamToTuple, value, step, beat, true)
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

  assert([0,4], evalParamEvent(()=>[0,perEventValue], 0, 0))
  assert([0,4], evalParamFrame(()=>[0,perEventValue], 0, 0))
  assert([0,3], evalParamFrame(()=>[0,perFrameValue], 0, 0))
  assert(0, evalParamEvent(()=>[0,perFrameValue], 0, 0)[0])
  assert(3, evalParamEvent(()=>[0,perFrameValue], 0, 0)[1](0,0))
  assert('frame', evalParamEvent(()=>[0,perFrameValue], 0, 0)[1].interval)

  assert({a:4}, evalParamFrame({a:perEventValue}, 0, 0))
  assert({a:3}, evalParamFrame({a:perFrameValue}, 0, 0))
  assert({a:4}, evalParamEvent({a:perEventValue}, 0, 0))
  assert('frame', evalParamEvent({a:perFrameValue}, 0, 0).a.interval)

  assert([1,2], evalParamToTuple(()=>[1,2], 0, 0))
  assert([1,2], evalParamToTuple([()=>[1,2]], 0, 0))
  assert(2, evalParamToTuple(()=>[()=>2], 0, 0)[0])
  assert(2, evalParamToTuple([()=>[()=>2]], 0, 0)[0])
  assert('frame', evalParamToTuple(()=>[perFrameValue], 0, 0)[0].interval)
  assert(4, evalParamToTuple(()=>[perEventValue], 0, 0)[0])

  console.log('Eval param (old) tests complete')

  return {
    evalParamEvent:evalParamEvent,
    evalParamFrame:evalParamFrame,
    evalParamToTuple: evalParamToTuple,
  }

})
