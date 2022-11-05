'use strict';
define((require) => {
  let {overrideKey,applyModifiers} = require('player/time-modifiers')

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
    let override = applyModifiers(results, mods, event, beat)
    if (override !== undefined) { return override }
    let originalCount = event.count
    event.count = results.modCount
    let result = value(event, results.modBeat, (v,e,b) => {
      let oldEc = e.count
      e.count = originalCount
      let result = evalRecurse(v, e, beat)
      e.count = oldEc
      return result
    }, mods)
    event.count = originalCount
    return result
  }

  let evalFunctionWithModifiers = (value, event, beat, evalRecurse) => {
    if (value.interval === 'event') { beat = event.count } // Force per event if explicitly called for
    if (value.modifiers === undefined) {
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

  let evalParamValue = (evalRecurse, value, event, beat, {nestedChords,ignoreThisVars}) => {
    if (Array.isArray(value)) { // chord, eval individual values
      let v = value.map(v => evalRecurse(v, event, beat))
      if (!nestedChords) { v = v.flat() }
      return v
    } else if (typeof value == 'function') { // Call function to get current value
      if (ignoreThisVars && value._thisVar) { return 0 } // return 0 to hold a place in a chord
      let v = evalFunctionWithModifiers(value, event, beat, evalRecurse)
      return evalRecurse(v, event, beat)
    } else if (typeof value == 'object') { // Eval each field in the object
      let result = {}
      for (let k in value) {
        result[k] = evalRecurse(value[k], event, beat)
      }
      let r = expandObjectChords(result) // and hoist chords up
      return r.length === 1 ? r[0] : r
    } else {
      return value
    }
  }

  let evalRecurseFull = (value, event, beat, options) => {
    options = options || {}
    return evalParamValue(evalRecurseWithOptions(evalRecurseFull, options), value, event, beat, options)
  }
  let evalRecursePre = (value, event, beat, options) => {
    if (!!value && value.interval === 'frame') {
      return value
    }
    options = options || {}
    return evalParamValue(evalRecurseWithOptions(evalRecursePre, options), value, event, beat, options)
  }

  let evalRecurseWithOptions = (er, options) => {
    return (v,e,b) => {
      return er(v,e,b,options)
    }
  }

  let evalParamFrame = (value, event, beat) => {
    // Fully evaluate down to a primitive number/string etc, allowing the value to change every frame if it wants to
    return evalParamValue(evalRecurseFull, value, event, beat, {})
  }

  let evalParamFrameNoFlatten = (value, event, beat) => {
    let options = {nestedChords:true}
    return evalParamValue(evalRecurseFull, value, event, beat, options)
  }

  let evalParamFrameIgnoreThisVars = (value, event, beat) => {
    let options = {ignoreThisVars:true}
    return evalParamValue(evalRecurseWithOptions(evalRecurseFull, options), value, event, beat, options)
  }

  let evalParamEvent = (value, event) => {
    // Fully evaluate down to a primitive number/string etc, fixing the value for the life of the event it is part of
    return evalParamValue(evalRecurseFull, value, event, event.count, {})
  }

  let preEvalParam = (value, event) => {
    // Evaluate only to values that are constant for the entire event
    if (!!value && value.interval === 'frame') {
      return value
    }
    return evalParamValue(evalRecursePre, value, event, event.count, {})
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
  assert([1,1], evalParamFrame(perEventThenFrameChord, ev(0), 1))

  let perEventThenFrameObject = {foo:perFrameValueGetB}
  perEventThenFrameObject.interval = 'event'
  assert({foo:0,interval:'event'}, evalParamEvent(perEventThenFrameObject, ev(0), 1))
  assert({foo:1,interval:'event'}, evalParamFrame(perEventThenFrameObject, ev(0), 1))

  assert(perFrameValue, preEvalParam({a:perFrameValue}, ev(0), 0).a)

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
