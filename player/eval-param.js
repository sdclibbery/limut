'use strict';
define((require) => {

  let expandObjectTuples = (o) => {
    let maxCardinality = 0
    for (let k in o) {
      if (Array.isArray(o[k])) {
        maxCardinality = Math.max(maxCardinality, o[k].length)
      }
    }
    if (maxCardinality == 0) { return o }
    let os = []
    for (let i=0; i<maxCardinality; i++) {
      let on = {}
      for (let k in o) {
        let v = o[k]
        if (Array.isArray(v)) {
          on[k] = v[i%v.length]
        } else {
          on[k] = v
        }
      }
      os.push(on)
    }
    return os
  }

  let evalParamNow = (evalRecurse, value, event, beat) => {
    if (Array.isArray(value)) { // tuple, eval individual values
      return value.map(v => evalRecurse(v, event, beat)).flat()
    } else if (typeof value == 'function') { // Call function to get current value
      let v = value(event, beat, evalRecurse)
      return evalRecurse(v, event, beat)
    } else if (typeof value == 'object') { // Eval each field in the object
      let result = {}
      for (let k in value) {
        result[k] = evalRecurse(value[k], event, beat)
      }
      return expandObjectTuples(result) // and hoist tuples up
    } else {
      return value
    }
  }

  let evalParamFrame = (value, event, beat) => {
    // Fully evaluate down to a primitive number/string etc, allowing the value to change every frame if it wants to
    return evalParamNow(evalParamFrame, value, event, beat)
  }

  let evalParamEvent = (value, event) => {
    // Fully evaluate down to a primitive number/string etc, fixing the value for the life of the event it is part of
    return evalParamNow(evalParamEvent, value, event, event.count)
  }

  let preEvalParam = (value, event) => {
    // Evaluate only to values that are constant for the entire event
    if (!!value && value.interval === 'frame') {
      return value
    }
    return evalParamNow(preEvalParam, value, event, event.count)
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let ev = (n) => {return{idx:n,count:n}}

  assert(undefined, evalParamEvent(undefined, ev(0)))
  assert(1, evalParamEvent(1, ev(0)))
  assert(1/2, evalParamEvent(1/2, ev(0)))
  assert(5, evalParamEvent(() => 5, ev(0)))
  assert(5, evalParamEvent((e,b) => b, ev(5)))
  assert({x:1}, evalParamEvent({x:()=>1}, ev(0)))
  assert('a', evalParamEvent('a', ev(0)))
  assert([1,2], evalParamEvent([1,2], ev(0)))
  assert([1,5], evalParamEvent([1,() => 5], ev(0)))
  assert([{x:1},{x:2}], evalParamEvent({x:[1,2]}, ev(0)))
  assert([{x:1,y:3},{x:2,y:4}], evalParamEvent({x:[1,2],y:[3,4]}, ev(0)))
  assert([{x:1,y:4},{x:2,y:5},{x:3,y:4}], evalParamEvent({x:[1,2,3],y:[4,5]}, ev(0)))
  assert([1,2,3], evalParamEvent([1,[2,3]], ev(0)))
  assert([{x:1},{x:2},{x:3}], evalParamEvent([{x:1},{x:[2,3]}], ev(0)))
  assert([1,2,3], evalParamEvent([1,() => [2,3]], ev(0)))

  let perFrameValue = () => 3
  perFrameValue.interval= 'frame'
  let perEventValue = () => 4
  perEventValue.interval= 'event'

  assert(1, evalParamFrame(1, ev(0), 0))
  assert(3, evalParamEvent(perFrameValue, ev(0)))
  assert(perFrameValue, preEvalParam(perFrameValue, ev(0)))
  assert(3, evalParamFrame(perFrameValue, ev(0), 0))
  assert(1, evalParamFrame(1, ev(0), 0))
  assert(4, evalParamEvent(perEventValue, ev(0)))
  assert(4, preEvalParam(perEventValue, ev(0)))
  assert(4, evalParamFrame(perEventValue, ev(0), 0))

  assert({a:4}, evalParamFrame({a:perEventValue}, ev(0), 0))
  assert({a:3}, evalParamFrame({a:perFrameValue}, ev(0), 0))
  assert({a:4}, evalParamEvent({a:perEventValue}, ev(0)))
  assert({a:3}, evalParamEvent({a:perFrameValue}, ev(0)))
  assert({a:4}, preEvalParam({a:perEventValue}, ev(0)))
  assert('frame', preEvalParam({a:perFrameValue}, ev(0)).a.interval)
  assert({r:1}, evalParamFrame(()=>{return({r:1})}, ev(0), 0))
  assert([{r:1,g:3},{r:2,g:3}], evalParamFrame(()=>{return({r:()=>[1,2],g:3})}, ev(0), 0))

  console.log('Eval param tests complete')
  }

  return {
    preEvalParam:preEvalParam,
    evalParamEvent:evalParamEvent,
    evalParamFrame:evalParamFrame,
  }

})
