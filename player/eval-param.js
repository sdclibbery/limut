'use strict';
define((require) => {

  let evalParamNow = (evalRecurse, value, event, beat, stopAtTuple) => {
    if (Array.isArray(value)) {
      let v = value[Math.floor(event.idx) % value.length]
      if (typeof v == 'function') {
        return evalRecurse(v, event, beat, evalRecurse)
      }
      return v
    } else if (typeof value == 'function') {
      let v = value(event, beat, evalRecurse)
      if (Array.isArray(v)) {
        if (stopAtTuple) { return v.map(x=>evalParamEvent(x, event, beat, evalParamEvent)) }
        return v.map(e => evalRecurse(e, event, beat, evalRecurse))
      }
      return evalRecurse(v, event, beat)
    } else if (typeof value == 'object') {
      let result = {}
      for (let k in value) {
        result[k] = evalRecurse(value[k], event, beat, evalRecurse)
      }
      return result
    } else {
      return value
    }
  }

  let evalParamFrame = (value, event, beat) => {
    return evalParamNow(evalParamFrame, value, event, beat)
  }

  let evalParamEvent = (value, event, beat) => {
    if (!!value && value.interval === 'frame') { return value }
    return evalParamNow(evalParamEvent, value, event, beat)
  }

  let evalParamToTuple = (value, event, beat) => {
    return evalParamNow(evalParamToTuple, value, event, beat, true)
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let ev = (i,c) => {return{idx:i,count:c}}

  assert(undefined, evalParamEvent(undefined, ev(0), 0))
  assert(1, evalParamEvent(1, ev(0), 0))
  assert(1/2, evalParamEvent(1/2, ev(0), 0))
  assert(1, evalParamEvent([1,2,3], ev(0), 0))
  assert(1, evalParamEvent([1,2,3], ev(0.5), 0))
  assert(2, evalParamEvent([1,2,3], ev(1), 0))
  assert(3, evalParamEvent([1,2,3], ev(2), 0))
  assert(1, evalParamEvent([1,2,3], ev(3), 0))
  assert(5, evalParamEvent(() => 5, ev(0), 0))
  assert(5, evalParamEvent((x,y) => y, ev(0), 5))
  assert([1,2], evalParamEvent([()=>[1,2]], ev(0), 0))
  assert([3,4], evalParamEvent([()=>[1,2],()=>[3,4]], ev(1), 0))
  assert({x:1}, evalParamEvent({x:[1,2]}, ev(0), 0))
  assert({x:2}, evalParamEvent({x:[1,2]}, ev(1), 1))
  assert('a', evalParamEvent('a', ev(0), 0))
  assert('a', evalParamEvent(['a','b'], ev(0), 0))
  assert('b', evalParamEvent(['a','b'], ev(1), 1))

  let perFrameValue = () => 3
  perFrameValue.interval= 'frame'
  let perEventValue = () => 4
  perEventValue.interval= 'event'

  assert(1, evalParamFrame(1, ev(0), 0))
  assert(perFrameValue, evalParamEvent(perFrameValue, ev(0), 0))
  assert(3, evalParamFrame(perFrameValue, ev(0), 0))
  assert(1, evalParamFrame(1, ev(0), 0))
  assert(4, evalParamEvent(perEventValue, ev(0), 0))
  assert(4, evalParamFrame(perEventValue, ev(0), 0))

  assert([0,4], evalParamEvent(()=>[0,perEventValue], ev(0), 0))
  assert([0,4], evalParamFrame(()=>[0,perEventValue], ev(0), 0))
  assert([0,3], evalParamFrame(()=>[0,perFrameValue], ev(0), 0))
  assert(0, evalParamEvent(()=>[0,perFrameValue], ev(0), 0)[0])
  assert(3, evalParamEvent(()=>[0,perFrameValue], ev(0), 0)[1](0,0))
  assert('frame', evalParamEvent(()=>[0,perFrameValue], ev(0), 0)[1].interval)

  assert({a:4}, evalParamFrame({a:perEventValue}, ev(0), 0))
  assert({a:3}, evalParamFrame({a:perFrameValue}, ev(0), 0))
  assert({a:4}, evalParamEvent({a:perEventValue}, ev(0), 0))
  assert('frame', evalParamEvent({a:perFrameValue}, ev(0), 0).a.interval)

  assert([1,2], evalParamToTuple(()=>[1,2], ev(0), 0))
  assert([1,2], evalParamToTuple([()=>[1,2]], ev(0), 0))
  assert(2, evalParamToTuple(()=>[()=>2], ev(0), 0)[0])
  assert(2, evalParamToTuple([()=>[()=>2]], ev(0), 0)[0])
  assert('frame', evalParamToTuple(()=>[perFrameValue], ev(0), 0)[0].interval)
  assert(4, evalParamToTuple(()=>[perEventValue], ev(0), 0)[0])

  console.log('Eval param tests complete')
  }

  return {
    evalParamEvent:evalParamEvent,
    evalParamFrame:evalParamFrame,
    evalParamToTuple: evalParamToTuple,
  }

})
