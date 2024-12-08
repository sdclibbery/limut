'use strict';
define((require) => {
  let {overrideKey,applyModifiers} = require('expression/time-modifiers')
  let system = require('play/system')
  let {combineIntervals} = require('expression/intervals')

  let expandObjectChords = (o) => {
    for (let k in o) {
      let vs = o[k]
      if (Array.isArray(vs)) {
        let es = []
        vs.forEach(v => {
          let on = Object.assign({}, o)
          on[k] = v
          es.push(...expandObjectChords(on))
        })
        return es
      }
    }
    return [o]
  }

  let results = {}
  let evalFunction = (value, mods, event, beat, evalRecurse) => {
    let override = applyModifiers(results, mods, event, beat, value.interval)
    if (override !== undefined) { return override }
    let originalCount = event.count
    event.count = results.modCount
    let result = value(event, results.modBeat, (v,e,b,o) => { // Pass an evalRecurse that cancels the modifiers
      let oldEc = e.count
      e.count = originalCount
      let result = evalRecurse(v, e, beat,o)
      e.count = oldEc
      return result
    }, mods)
    event.count = originalCount
    return result
  }

  let evalFunctionWithModifiers = (value, event, beat, evalRecurse) => {
    if (value.interval === 'event') { beat = event.count } // Force per event if explicitly called for
    if (typeof value.modifiers !== 'object') {
      return value(event, beat, evalRecurse) // No modifiers
    }
    let mods = evalParamFrame(value.modifiers, event, beat)
    let result
    if (!Array.isArray(mods)) {
      result = evalFunction(value, mods, event, beat, evalRecurse)
    } else {
      result = mods.map(m => {
        let e = Object.assign({}, event) // Copy event so things keyed from the event work properly
        return evalFunction(value, m, e, beat, evalRecurse)
      })
    }
    return result
  }

  let evalParamValue = (evalRecurse, value, event, beat, {ignoreThisVars,evalToObjectOrPrimitive}) => {
    if (Array.isArray(value)) { // chord, eval individual values
      let v = value.map(v => evalRecurse(v, event, beat))
      v = v.flat()
      return v
    } else if (typeof value == 'function') { // Call function to get current value
      if (ignoreThisVars && value._thisVar) { return 0 } // return 0 to hold a place in a chord
      if (value.isDeferredVarFunc) { return value } // Do not eval delayed function
      let v = evalFunctionWithModifiers(value, event, beat, evalRecurse)
      v = evalRecurse(v, event, beat)
      return v
    } else if (typeof value === 'object' && !(value instanceof AudioNode) && value.__interval === undefined) {
      let result = {}
      let interval = 'const'
      for (let k in value) { // Eval each field in the object
       if (evalToObjectOrPrimitive) {
         result[k] = value[k] // Pass without evaluation
       } else {
         result[k] = evalRecurse(value[k], event, beat)
       }
      }
      let r = expandObjectChords(result) // and hoist chords up
      r = r.length === 1 ? r[0] : r
      return r
    } else {
      return value
    }
  }

  let evalParamValueWithMemoisation = (evalRecurse, value, event, beat, options) => {
    if (value === undefined) { return value }
    if (!!value.interval_memo && value.interval_memo.has(event)) {
      return value.interval_memo.get(event)
    }
    let result = evalParamValue(evalRecurse, value, event, beat, options)
    if (value.interval === 'event') {
      if (system.timeNow() >= event._time) { // Dont memoise until the event start time
        if (!value.interval_memo) { value.interval_memo = new WeakMap() }
        value.interval_memo.set(event, result)
      }
    }
    return result
  }

  let evalRecurseFull = (value, event, beat, options) => {
    options = options || {}
    return evalParamValueWithMemoisation(evalRecurseWithOptions(evalRecurseFull, options), value, event, beat, options)
  }

  let evalRecurseWithOptions = (er, options) => {
    return (v,e,b, moreOptions) => {
      if (typeof moreOptions === 'object') {
        if (typeof options === 'object') { Object.assign(options, moreOptions) }
        else { options = moreOptions }
      }
      return er(v,e,b,options)
    }
  }

  let evalDeferredFunc = (result, event, beat, evalRecurse, options) => {
    if (Array.isArray(result)) {
      return result.map(v => evalDeferredFunc(v, event, beat, evalRecurse, options))
    }
    if (typeof result == 'function' && result.isDeferredVarFunc) {
      if (options.ignoreThisVars && result._thisVar) { return 0 }
      if (result._requiresValue && (!result.modifiers || result.modifiers.value === undefined)) {
        return result.string // If function requires value, return string instead to support blend=max etc
      }
      let v = evalFunctionWithModifiers(result, event, beat, evalRecurse)
      if (result.interval === 'event') { beat = event.count } // Force per event if explicitly called for
      return evalRecurse(v, event, beat)
    }
    if (typeof result === 'object' && !(result instanceof AudioNode)) {
      let v = {}
      for (let k in result) {
        v[k] = evalDeferredFunc(result[k], event, beat, evalRecurse, options)
      }
      return v
    }
    return result
  }

  let noOptions = {}
  let evalParamFrame = (value, event, beat) => {
    // Fully evaluate down to a primitive number/string etc, allowing the value to change every frame if it wants to
    return evalDeferredFunc(evalParamValueWithMemoisation(evalRecurseFull, value, event, beat, noOptions), event, beat, evalRecurseFull, noOptions)
  }

  let evalParamFrameIgnoreThisVars = (value, event, beat) => {
    let options = {ignoreThisVars:true}
    let er = evalRecurseWithOptions(evalRecurseFull, options)
    return evalDeferredFunc(evalParamValueWithMemoisation(er, value, event, beat, options), event, beat, er, options)
  }

  let evalParamToObjectOrPrimitive = (value, event, beat) => {
    let options = {evalToObjectOrPrimitive:true}
    let er = evalRecurseWithOptions(evalRecurseFull, options)
    return evalDeferredFunc(evalParamValueWithMemoisation(er, value, event, beat, options), event, beat, er, options)
  }

  let evalParamEvent = (value, event) => {
    // Fully evaluate down to a primitive number/string etc, fixing the value for the life of the event it is part of
    return evalDeferredFunc(evalParamValueWithMemoisation(evalRecurseFull, value, event, event.count, noOptions), event, event.count, evalRecurseFull, noOptions)
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let ev = (n,t) => {return{idx:n,count:n,_time:t}}

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
  
  let perFrameValue = () => 3
  perFrameValue.interval= 'frame'
  let perEventValue = () => 4
  perEventValue.interval= 'event'

  assert(1, evalParamFrame(1, ev(0), 0))
  assert(3, evalParamEvent(perFrameValue, ev(0)))
  assert(3, evalParamFrame(perFrameValue, ev(0), 0))
  assert(1, evalParamFrame(1, ev(0), 0))
  assert(4, evalParamEvent(perEventValue, ev(0)))
  assert(4, evalParamFrame(perEventValue, ev(0), 0))

  assert({a:4}, evalParamFrame({a:perEventValue}, ev(0), 0))
  assert({a:3}, evalParamFrame({a:perFrameValue}, ev(0), 0))
  assert({a:4}, evalParamEvent({a:perEventValue}, ev(0)))
  assert({a:3}, evalParamEvent({a:perFrameValue}, ev(0)))
  assert({r:1}, evalParamFrame(()=>{return({r:1})}, ev(0), 0))
  assert([{r:1,g:3},{r:2,g:3}], evalParamFrame(()=>{return({r:()=>[1,2],g:3})}, ev(0), 0))

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
  let perEventThenFrameChord = [perFrameValueGetB,perFrameValueGetB]
  perEventThenFrameChord.interval = 'event'
  assert([0,0], evalParamEvent(perEventThenFrameChord, ev(0), 1))
  delete perEventThenFrameChord.interval_memo
  assert([1,1], evalParamFrame(perEventThenFrameChord, ev(0), 1))

  let perEventThenFrameObject = {foo:perFrameValueGetB}
  perEventThenFrameObject.interval = 'event'
  assert({foo:0,interval:'event'}, evalParamEvent(perEventThenFrameObject, ev(0), 1))
  delete perEventThenFrameObject.interval_memo
  assert({foo:1,interval:'event'}, evalParamFrame(perEventThenFrameObject, ev(0), 1))

  let perEventThenFrameValueGetB = (e,b,er) => er(perFrameValueGetB,e,b)
  perEventThenFrameValueGetB.interval = 'event'
  let e = ev(10,10) // when run at startup, the current system time should be less than this
  assert(10, evalParamEvent(perEventThenFrameValueGetB, e, 0.1))
  assert(10, evalParamEvent(perEventThenFrameValueGetB, e, 0.2))
  e._time = 0 // System time should be at least zero
  assert(10, evalParamEvent(perEventThenFrameValueGetB, e, 0.3))
  e._time = 10 // System time should be less again
  e.count = 20 // This new value should be ignored
  assert(10, evalParamEvent(perEventThenFrameValueGetB, e, 0.4))
  assert(10, evalParamEvent(perEventThenFrameValueGetB, e, 0.5))

  // Do not memoise if per frame, even if after event time
  e = ev(10,10) // when run at startup, the current system time should be less than this
  assert(10, evalParamEvent(perFrameValueGetB, e, 0.1))
  assert(10, evalParamEvent(perFrameValueGetB, e, 0.2))
  e._time = 0 // System time should be at least zero
  assert(10, evalParamEvent(perFrameValueGetB, e, 0.3))
  e._time = 10 // System time should be less again
  e.count = 20 // This new value should not be ignored, because we shouldn't memoise per frame values
  assert(20, evalParamEvent(perFrameValueGetB, e, 0.4))
  assert(20, evalParamEvent(perFrameValueGetB, e, 0.5))

  let constWithMods = () => 1
  constWithMods.modifiers = {}
  assert(1, evalParamFrame(constWithMods, ev(0), 1))

  let ovrs = (...vs) => {
    let r = {}
    vs.forEach(v => {
      r[overrideKey(v)] = 2*v
    })
    return r
  }

  constWithMods.modifiers = {overrides:ovrs(3,5)}
  assert(1, evalParamFrame(constWithMods, ev(0), 0))
  assert(6, evalParamFrame(constWithMods, ev(3), 3))
  assert(10, evalParamFrame(constWithMods, ev(5), 5))

  constWithMods.modifiers = {per:2,overrides:ovrs(0)}
  assert(0, evalParamFrame(constWithMods, ev(0), 0))
  assert(1, evalParamFrame(constWithMods, ev(1), 1))
  assert(0, evalParamFrame(constWithMods, ev(2), 2))

  constWithMods.modifiers = {overrides:ovrs(1/2)}
  assert(1, evalParamFrame(constWithMods, ev(1/2), 1/2))

  constWithMods.modifiers = {overrides:ovrs(1/3)}
  assert(2/3, evalParamFrame(constWithMods, ev(1/3), 1/3))

  let getCWithMods = (e,b) => e.count
  getCWithMods.modifiers = {overrides:ovrs()}
  assert(1, evalParamFrame(getCWithMods, ev(1), 0))

  getCWithMods.modifiers = {per:2,overrides:ovrs()}
  assert(0, evalParamFrame(getCWithMods, ev(0), 0))
  assert(1, evalParamFrame(getCWithMods, ev(1), 1))
  assert(0, evalParamFrame(getCWithMods, ev(2), 2))
  assert(1, evalParamFrame(getCWithMods, ev(3), 3))

  let getBWithMods = (e,b) => b
  getBWithMods.modifiers = {overrides:ovrs()}
  assert(1, evalParamFrame(getBWithMods, ev(0), 1))

  getBWithMods.modifiers = {per:2,overrides:ovrs()}
  assert(0, evalParamFrame(getBWithMods, ev(0), 0))
  assert(1, evalParamFrame(getBWithMods, ev(1), 1))
  assert(0, evalParamFrame(getBWithMods, ev(2), 2))
  assert(1, evalParamFrame(getBWithMods, ev(3), 3))

  getCWithMods.modifiers = {overrides:ovrs(1)}
  assert(0, evalParamFrame(getCWithMods, ev(0), 0))
  assert(2, evalParamFrame(getCWithMods, ev(1), 1))
  assert(2, evalParamFrame(getCWithMods, ev(2), 2))

  getBWithMods.modifiers = {overrides:ovrs(1)}
  assert(0, evalParamFrame(getBWithMods, ev(0), 0))
  assert(2, evalParamFrame(getBWithMods, ev(1), 1))
  assert(2, evalParamFrame(getBWithMods, ev(2), 2))

  let ov = {}
  ov[overrideKey(1)] = (e,b) => b*7
  getBWithMods.modifiers = {per:2,overrides:ov}
  assert(0, evalParamFrame(getBWithMods, ev(0), 0))
  assert(7, evalParamFrame(getBWithMods, ev(1), 1))
  assert(0, evalParamFrame(getBWithMods, ev(2), 2))
  assert(21, evalParamFrame(getBWithMods, ev(3), 3)) // override eval should not used the modified time

  getBWithMods.modifiers = {step:2}
  assert(0, evalParamFrame(getBWithMods, ev(0), 0))
  assert(0, evalParamFrame(getBWithMods, ev(0), 1))
  assert(2, evalParamFrame(getBWithMods, ev(0), 2))

  getBWithMods.modifiers = {step:1/2}
  assert(0, evalParamFrame(getBWithMods, ev(0), 0))
  assert(0, evalParamFrame(getBWithMods, ev(0), 1/4))
  assert(1/2, evalParamFrame(getBWithMods, ev(0), 1/2))
  assert(1/2, evalParamFrame(getBWithMods, ev(0), 3/4))
  assert(1, evalParamFrame(getBWithMods, ev(0), 1))

  getBWithMods.modifiers = {step:2,per:3}
  assert(0, evalParamFrame(getBWithMods, ev(0), 0))
  assert(0, evalParamFrame(getBWithMods, ev(0), 1))
  assert(2, evalParamFrame(getBWithMods, ev(0), 2))
  assert(0, evalParamFrame(getBWithMods, ev(0), 3))
  assert(0, evalParamFrame(getBWithMods, ev(0), 4))
  assert(2, evalParamFrame(getBWithMods, ev(0), 5))

  console.log('Eval param tests complete')
  }

  return {
    evalParamEvent:evalParamEvent,
    evalParamFrame:evalParamFrame,
    evalParamFrameIgnoreThisVars:evalParamFrameIgnoreThisVars,
    evalParamToObjectOrPrimitive:evalParamToObjectOrPrimitive,
    evalFunctionWithModifiers:evalFunctionWithModifiers,
  }

})
