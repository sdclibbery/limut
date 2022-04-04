'use strict';
define((require) => {

  let expandObjectTuples = (o) => {
    for (let k in o) {
      let vs = o[k]
      if (Array.isArray(vs)) {
        let es = []
        vs.forEach(v => {
          let on = Object.assign({}, o)
          on[k] = v
          es.push(...expandObjectTuples(on))
        })
        return es
      }
    }
    return [o]
  }

  let evalParamNow = (evalRecurse, value, event, beat, {nestedTuples,ignoreThisVars}) => {
    if (Array.isArray(value)) { // tuple, eval individual values
      let v = value.map(v => evalRecurse(v, event, beat))
      if (!nestedTuples) { v = v.flat() }
      return v
    } else if (typeof value == 'function') { // Call function to get current value
      if (value.evalOverride !== undefined) { return value.evalOverride }
      if (ignoreThisVars && value._thisVar) { return }
      let _originalBeat = beat
      if (value.interval === 'event') { beat = event.count } // Force per event if explicitly called for
      let v = value(event, beat, evalRecurse)
      beat = _originalBeat
      return evalRecurse(v, event, beat)
    } else if (typeof value == 'object') { // Eval each field in the object
      let result = {}
      for (let k in value) {
        result[k] = evalRecurse(value[k], event, beat)
      }
      let r = expandObjectTuples(result) // and hoist tuples up
      return r.length === 1 ? r[0] : r
    } else {
      return value
    }
  }

  let clearMods = (event, beat) => {
    if (event._originalB !== undefined) { // remove any time modification when recursing
      beat = event._originalB
      event.count = event._originalCount
    }
    return beat
  }
  let evalRecurseFull = (value, event, beat, options) => {
    beat = clearMods(event, beat)
    return evalParamNow(evalRecurseFull, value, event, beat, options || {})
  }
  let evalRecursePre = (value, event, beat, options) => {
    if (!!value && value.interval === 'frame') {
      return value
    }
    beat = clearMods(event, beat)
    return evalParamNow(evalRecursePre, value, event, beat, options || {})
  }

  let evalRecurseWithOptions = (er, options) => {
    return (v,e,b) => {
      return er(v,e,b,options)
    }
  }

  let evalParamFrame = (value, event, beat) => {
    // Fully evaluate down to a primitive number/string etc, allowing the value to change every frame if it wants to
    return evalParamNow(evalRecurseFull, value, event, beat, {})
  }

  let evalParamFrameNoFlatten = (value, event, beat) => {
    let options = {nestedTuples:true}
    return evalParamNow(evalRecurseFull, value, event, beat, options)
  }

  let evalParamFrameIgnoreThisVars = (value, event, beat) => {
    let options = {ignoreThisVars:true}
    return evalParamNow(evalRecurseWithOptions(evalRecurseFull, options), value, event, beat, options)
  }

  let evalParamEvent = (value, event) => {
    // Fully evaluate down to a primitive number/string etc, fixing the value for the life of the event it is part of
    return evalParamNow(evalRecurseFull, value, event, event.count, {})
  }

  let preEvalParam = (value, event) => {
    // Evaluate only to values that are constant for the entire event
    if (!!value && value.interval === 'frame') {
      return value
    }
    return evalParamNow(evalRecursePre, value, event, event.count, {})
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
  assert([{x:1,y:3},{x:1,y:4},{x:2,y:3},{x:2,y:4}], evalParamEvent({x:[1,2],y:[3,4]}, ev(0)))
  assert([{x:1,y:4},{x:1,y:5},{x:2,y:4},{x:2,y:5},{x:3,y:4},{x:3,y:5}], evalParamEvent({x:[1,2,3],y:[4,5]}, ev(0)))
  assert([1,2,3], evalParamEvent([1,[2,3]], ev(0)))
  assert([{x:1},{x:2},{x:3}], evalParamEvent([{x:1},{x:[2,3]}], ev(0)))
  assert([1,2,3], evalParamEvent([1,() => [2,3]], ev(0)))
  assert([1,2,3,4], evalParamEvent([[1,2],[3,4]], ev(0)))
  assert([[1,2],[3,4]], evalParamFrameNoFlatten([[1,2],[3,4]], ev(0)))
  assert([1,2,3,4], preEvalParam([[1,2],[3,4]], ev(0)))
  
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

  let overriddenFunc = () => 7
  overriddenFunc.evalOverride = 'Foo'
  assert('Foo', evalParamFrame(overriddenFunc, ev(0), 0))

  let perEventValueGetB = (e,b) => b
  perEventValueGetB.interval= 'event'
  assert(0, evalParamEvent(perEventValueGetB, ev(0), 1))
  assert(0, evalParamFrame(perEventValueGetB, ev(0), 1))
  let perFrameThenEventValueGetB = (e,b,er) => er(perEventValueGetB,e,b)
  perFrameThenEventValueGetB.interval = 'frame'
  assert(0, evalParamEvent(perFrameThenEventValueGetB, ev(0), 1))
  assert(0, evalParamFrame(perFrameThenEventValueGetB, ev(0), 1))

  let perFrameValueGetB = (e,b) => b
  perFrameValueGetB.interval= 'frame'
  let perEventThenFrameTuple = [perFrameValueGetB,perFrameValueGetB]
  perEventThenFrameTuple.interval = 'event'
  assert([0,0], evalParamEvent(perEventThenFrameTuple, ev(0), 1))
  assert([1,1], evalParamFrame(perEventThenFrameTuple, ev(0), 1))

  let perEventThenFrameObject = {foo:perFrameValueGetB}
  perEventThenFrameObject.interval = 'event'
  assert({foo:0,interval:'event'}, evalParamEvent(perEventThenFrameObject, ev(0), 1))
  assert({foo:1,interval:'event'}, evalParamFrame(perEventThenFrameObject, ev(0), 1))

  console.log('Eval param tests complete')
  }

  return {
    preEvalParam:preEvalParam,
    evalParamEvent:evalParamEvent,
    evalParamFrame:evalParamFrame,
    evalParamFrameNoFlatten:evalParamFrameNoFlatten,
    evalParamFrameIgnoreThisVars:evalParamFrameIgnoreThisVars,
  }

})
