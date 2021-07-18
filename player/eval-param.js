'use strict';
define((require) => {

  let evalParamNow = (evalRecurse, value, event, beat) => {
    if (Array.isArray(value)) {
      return value
    } else if (typeof value == 'function') { // Call function to get current value
      let v = value(event, beat, evalRecurse)
      return evalRecurse(v, event, beat)
    } else if (typeof value == 'object') { // Eval each field in the object
      value.__evaluated = value.__evaluated || {} // cache result object to avoid creating per-frame garbage
      for (let k in value) {
        if (k !== '__evaluated') {
          value.__evaluated[k] = evalRecurse(value[k], event, beat, evalRecurse)
        }
      }
      return value.__evaluated
    } else {
      return value
    }
  }

  let evalParamFrame = (value, event, beat) => { // Fully evaluate down to a primitive number/string etc
    return evalParamNow(evalParamFrame, value, event, beat)
  }

  let evalParamEvent = (value, event, beat) => { // Evaluate only values that are constant for the entire event
    if (!!value && value.interval === 'frame') {
      return value
    }
    return evalParamNow(evalParamEvent, value, event, beat)
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
  assert(5, evalParamEvent(() => 5, ev(0), 0))
  assert(5, evalParamEvent((x,y) => y, ev(0), 5))
  assert({x:1}, evalParamEvent({x:()=>1}, ev(0), 0))
  assert('a', evalParamEvent('a', ev(0), 0))

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

  assert({a:4}, evalParamFrame({a:perEventValue}, ev(0), 0))
  assert({a:3}, evalParamFrame({a:perFrameValue}, ev(0), 0))
  assert({a:4}, evalParamEvent({a:perEventValue}, ev(0), 0))
  assert('frame', evalParamEvent({a:perFrameValue}, ev(0), 0).a.interval)

  console.log('Eval param tests complete')
  }

  return {
    evalParamEvent:evalParamEvent,
    evalParamFrame:evalParamFrame,
  }

})
