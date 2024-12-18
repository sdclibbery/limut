'use strict';
define((require) => {
  let {overrideKey,applyModifiers} = require('expression/time-modifiers')
  let {getEvalState} = require('player/eval-state')

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

  let wrapWithInterval = (v, value) => {
    if (value.interval === 'frame' && typeof v !== 'object') {
      v = {value:v, interval:value.interval} // Wrap to provide interval
    }
    if (value.interval === 'frame' && (typeof v === 'object' || v.interval === undefined)) {
      if (v._nextSegment === undefined) { v.interval = value.interval } // Set interval
    }
    if (value.interval === 'event' && (typeof v === 'object' || v.interval === 'frame')) { // [[1]t@f]t@e case; remove frame wrapper
      v = v.value // Extract value; remove interval wrapper
    }
    return v
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

  let shouldForcePerEvent = (value) => value.interval === 'event'
  
  let evalFunctionWithModifiers = (value, event, beat, evalRecurse) => {
    if (shouldForcePerEvent(value)) { // Force per event if explicitly called for
      beat = event.count
    }
    if (typeof value.modifiers !== 'object') {
      return value(event, beat, evalRecurse) // No modifiers
    }
    let mods = evalRecurse(value.modifiers, event, beat)
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

  let evalParamValue = (evalRecurse, value, event, beat, {ignoreThisVars,evalToObjectOrPrimitive,withInterval}) => {
    if (Array.isArray(value)) { // chord, eval individual values
      let v = value.map(v => evalRecurse(v, event, beat))
      v = v.flat()
      return v
    } else if (typeof value == 'function') { // Call function to get current value
      if (ignoreThisVars && value._thisVar) { return 0 } // return 0 to hold a place in a chord
      let v = evalFunctionWithModifiers(value, event, beat, evalRecurse)
      v = evalRecurse(v, event, beat)
      if (withInterval) { v = wrapWithInterval(v, value) }
      return v
    } else if (typeof value === 'object' && !(value instanceof AudioNode)) {
      let result = {}
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
    let memoKey = JSON.stringify(options) + beat
    let __functionArgs = getEvalState('__functionArgs')
    // if (__functionArgs) { memoKey += __functionArgs.__functionContext }
    if (typeof value === 'function' && value.__memo_event && value.__memo_event.has(event) && value.__memo_event.get(event).hasOwnProperty(memoKey)) {
      return value.__memo_event.get(event)[memoKey] // Return memoised result
    }
    let result = evalParamValue(evalRecurse, value, event, beat, options)
    if (typeof result === 'object' && result._finalResult) { // If result is final and hasn't been unwrapped, do it now
      result = result.value
    }
    if (typeof value === 'function') { // Set memoised result
      if (value.__memo_event === undefined) { value.__memo_event = new WeakMap() }
      if (!value.__memo_event.has(event)) { value.__memo_event.set(event, {}) }
      value.__memo_event.get(event)[memoKey] = result
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

  let noOptions = {}
  let evalParamFrame = (value, event, beat) => {
    // Fully evaluate down to a primitive number/string etc, allowing the value to change every frame if it wants to
    return evalParamValueWithMemoisation(evalRecurseFull, value, event, beat, noOptions)
  }

  let evalParamFrameWithInterval = (value, event, beat) => {
    let options = {withInterval:true}
    let er = evalRecurseWithOptions(evalRecurseFull, options)
    return evalParamValueWithMemoisation(er, value, event, beat, options)
  }

  let evalParamFrameIgnoreThisVars = (value, event, beat) => {
    let options = {ignoreThisVars:true}
    let er = evalRecurseWithOptions(evalRecurseFull, options)
    return evalParamValueWithMemoisation(er, value, event, beat, options)
  }

  let evalParamToObjectOrPrimitive = (value, event, beat) => {
    let options = {evalToObjectOrPrimitive:true}
    let er = evalRecurseWithOptions(evalRecurseFull, options)
    return evalParamValueWithMemoisation(er, value, event, beat, options)
  }

  let evalParamEvent = (value, event) => {
    // Fully evaluate down to a primitive number/string etc, fixing the value for the life of the event it is part of
    return evalParamValueWithMemoisation(evalRecurseFull, value, event, event.count, noOptions)
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let ev = (n,t) => {return{idx:n,count:n,_time:t}}
  let val = v => typeof v === 'object' && v.value !== undefined ? v.value : v

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
  assert(3, evalParamFrame({a:perFrameValue}, ev(0), 0).a)
  assert(4, evalParamEvent({a:perEventValue}, ev(0)).a)
  assert(3, evalParamEvent({a:perFrameValue}, ev(0)).a)
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
  assert([0,0], evalParamEvent(perEventThenFrameChord, ev(0)).map(val))
  delete perEventThenFrameChord.interval_memo
  assert([1,1], evalParamFrame(perEventThenFrameChord, ev(0), 1).map(val))

  let perEventThenFrameObject = {foo:perFrameValueGetB}
  perEventThenFrameObject.interval = 'event'
  assert({foo:0,interval:'event'}, evalParamEvent(perEventThenFrameObject, ev(0)))
  delete perEventThenFrameObject.interval_memo
  assert({foo:1,interval:'event'}, evalParamFrame(perEventThenFrameObject, ev(0), 1))

  delete perEventThenFrameObject.interval_memo
  assert({foo:{value:1,interval:'frame'},interval:'event'}, evalParamFrameWithInterval(perEventThenFrameObject, ev(0), 1))

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
    evalParamFrameWithInterval:evalParamFrameWithInterval,
    evalParamFrameIgnoreThisVars:evalParamFrameIgnoreThisVars,
    evalParamToObjectOrPrimitive:evalParamToObjectOrPrimitive,
    evalFunctionWithModifiers:evalFunctionWithModifiers,
  }

})
