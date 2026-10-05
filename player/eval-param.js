'use strict';
define((require) => {
  let {overrideKey,applyModifiers} = require('expression/time-modifiers')
  let {getCallTreeString} = require('player/callstack')
  let vars = require('vars')

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

  let hasChordField = (o) => {
    for (let k in o) { if (Array.isArray(o[k])) { return true } }
    return false
  }

  let wrapWithInterval = (v, value) => {
    if (value.interval === 'frame' && typeof v !== 'object') {
      v = {value:v, interval:value.interval} // Wrap to provide interval
    }
    if (value.interval === 'frame' && (typeof v === 'object' || v.interval === undefined)) {
      v.interval = value.interval // Set interval (incl. on segment wrappers, so nested @s+@f routes per-frame)
    }
    if (value.interval === 'event' && v.interval === 'frame') { // [[1]t@f]t@e case; remove frame wrapper
      v = v.value // Extract value; remove interval wrapper
    }
    return v
  }

  let results = {}
  let evalFunction = (value, mods, event, beat, evalRecurse) => {
    let override = applyModifiers(results, mods, event, beat, value.interval, evalParamEvent,evalParamFrame)
    if (override !== undefined) { return override }
    let originalCount = event.count
    event.count = results.modCount
    let er = (v,e,b,o) => { // Pass an evalRecurse that cancels the modifiers
      let oldEc = e.count
      e.count = originalCount
      let result = evalRecurse(v, e, beat,o)
      e.count = oldEc
      return result
    }
    er.options = evalRecurse.options // Without this, a node built inside a var function can't see expandingChords and builds for real
    let resultWrapper = value(event, results.modBeat, er, mods)
    event.count = originalCount
    return resultWrapper
  }

  let shouldForcePerEvent = (value) => value.interval === 'event'

  let evalModifiers = (modifiers, event, beat, evalRecurse) => {
    let lambdas // Lambda-valued args must pass through unevaluated: calling them bare here would eval their body with no call context (orphan node chains, spurious side effects), and every callee that takes a lambda wants the raw function anyway
    for (let k in modifiers) {
      let v = modifiers[k]
      if (typeof v === 'function' && v.isUserFunction) {
        if (lambdas === undefined) { lambdas = {} }
        lambdas[k] = v
      }
    }
    if (lambdas === undefined) { return evalRecurse(modifiers, event, beat) }
    let rest = {}
    for (let k in modifiers) { if (lambdas[k] === undefined) { rest[k] = modifiers[k] } }
    let mods = evalRecurse(rest, event, beat)
    if (Array.isArray(mods)) { mods.forEach(m => Object.assign(m, lambdas)) } // Chord in a sibling arg
    else { Object.assign(mods, lambdas) }
    return mods
  }

  let skipsModifiers = (value) => {
    if (!value.isVarLookup || value.namespace) { return false }
    let target = vars.get(value._name)
    return typeof target === 'function' && !!target.dontEvalModifiers
  }

  let evalFunctionWithModifiers = (value, event, beat, evalRecurse) => {
    if (shouldForcePerEvent(value)) { // Force per event if explicitly called for
      beat = event.count
    }
    if (typeof value.modifiers !== 'object' || skipsModifiers(value)) {
      return value(event, beat, evalRecurse) // No modifiers
    }
    let mods = evalModifiers(value.modifiers, event, beat, evalRecurse)
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

  let evalParamValue = (evalRecurse, value, event, beat, {expandingChords,evalToObjectOrPrimitive,withInterval}) => {
    if (Array.isArray(value)) { // chord, eval individual values
      let v = value.map(v => evalRecurse(v, event, beat))
      v = v.flat()
      return v
    } else if (typeof value == 'function') { // Call function to get current value
      if (expandingChords && value._chordPlaceholder) { return 0 } // return 0 to hold a place in a chord
      let v = evalFunctionWithModifiers(value, event, beat, evalRecurse)
      v = evalRecurse(v, event, beat)
      if (withInterval) { v = wrapWithInterval(v, value) }
      return v
    } else if (typeof value === 'object' && !(value instanceof AudioNode) && !value.isShaderNode && !value.isVisualTextureSource) {
      let result = {}
      for (let k in value) { // Eval each field in the object
       if (evalToObjectOrPrimitive) {
         result[k] = value[k] // Pass without evaluation
       } else {
         result[k] = evalRecurse(value[k], event, beat)
       }
      }
      if (!hasChordField(result)) { return result }
      let r = expandObjectChords(result) // and hoist chords up
      return r.length === 1 ? r[0] : r
    } else {
      return value
    }
  }

  // Memo per (value, event) holds just two beats: the event's own, kept while the event lasts (it is
  // what freezes an @e slider or midi value), and the latest other one. Keeping every beat would
  // grow the memo by an entry per frame for as long as the event lives. Each slot holds its first
  // key inline, as nearly every lookup has the same (empty) key and a Map costs an allocation per reset.
  let newSlot = () => ({beat: undefined, key: undefined, result: undefined, more: undefined})
  let memoSlot = (value, event, beat) => {
    if (value.__memo_event === undefined) { value.__memo_event = new WeakMap() }
    let memo = value.__memo_event.get(event)
    if (memo === undefined) {
      memo = {event: newSlot(), frame: newSlot()}
      value.__memo_event.set(event, memo)
    }
    let slot = beat === event.count ? memo.event : memo.frame
    if (slot.beat !== beat) {
      slot.beat = beat
      slot.key = undefined
      slot.result = undefined
      slot.more = undefined
    }
    return slot
  }
  let memoHas = (slot, key) => slot.key === key || (slot.more !== undefined && slot.more.has(key))
  let memoGet = (slot, key) => slot.key === key ? slot.result : slot.more.get(key)
  let memoSet = (slot, key, result) => {
    if (slot.key === undefined || slot.key === key) {
      slot.key = key
      slot.result = result
    } else {
      if (slot.more === undefined) { slot.more = new Map() }
      slot.more.set(key, result)
    }
  }

  let evalParamValueWithMemoisation = (evalRecurse, value, event, beat, options) => {
    if (value === undefined) { return value }
    if (typeof value === 'function' && value.isNonTemporal && shouldForcePerEvent(value)) { // static var functions include user input like slider, midi, gamepad etc which can't be forced per event just by forcing the beat time to the event time when evalling. So force them here too by memoising.
      beat = event.count
    }
    let memo, memoKey
    if (typeof value === 'function' && !options.doNotMemoise) {
      memoKey = ''
      for (let k in options) { if (options[k]) { memoKey += k } }
      let callTreeString = getCallTreeString()
      if (callTreeString) { memoKey += callTreeString }
      memo = memoSlot(value, event, beat)
      if (memoHas(memo, memoKey)) { return memoGet(memo, memoKey) }
    }
    let result = evalParamValue(evalRecurse, value, event, beat, options)
    if (typeof result === 'object' && result._finalResult) { // If result is final and hasn't been unwrapped, do it now
      result = result.value
    }
    if (memo !== undefined) { memoSet(memo, memoKey, result) }
    return result
  }

  let evalRecurseFull = (value, event, beat, options) => {
    if (options === undefined) { return evalParamValueWithMemoisation(evalRecurseFull, value, event, beat, noOptions) }
    return evalParamValueWithMemoisation(evalRecurseWithOptions(evalRecurseFull, options), value, event, beat, options)
  }

  let withOptionsCache = new WeakMap() // f only ever closes over options, so one per options object will do
  let evalRecurseWithOptions = (er, options) => {
    if (er === evalRecurseFull && withOptionsCache.has(options)) { return withOptionsCache.get(options) }
    let f = (v,e,b, moreOptions) => {
      if (typeof moreOptions === 'object') {
        if (typeof options === 'object') { Object.assign(options, moreOptions) }
        else { options = moreOptions }
      }
      return er(v,e,b,options)
    }
    f.options = options // expose mode (eg expandingChords) to raw operators like >>
    if (er === evalRecurseFull) { withOptionsCache.set(options, f) }
    return f
  }

  // Which clock the current evaluation runs on. The event clock (event.count) is the scheduled
  // beat, always ahead of the frame clock since the metronome fires early (and delay/swing add more).
  // Running values that integrate dt (accum/smooth/rate, functions/maths.js) keep one accumulator
  // per phase. The event phase is sticky: evalParamFrame calls nested in event time building
  // (param chains, pxfn bodies, node function args) still want the event's beat. Only
  // evalParamEvent sets it (in a finally), keeping the hot evalParamFrame free of this.
  let phase = 'frame'
  let evalPhase = () => phase

  let noOptions = Object.freeze({})
  let evalParamFrame = (value, event, beat, options) => {
    if (options !== undefined) {
      let er = evalRecurseWithOptions(evalRecurseFull, options)
      return evalParamValueWithMemoisation(er, value, event, beat, options)
    } else {
      return evalParamValueWithMemoisation(evalRecurseFull, value, event, beat, noOptions)
    }
  }

  let evalParamEvent = (value, event) => {
    let outerPhase = phase
    phase = 'event'
    try {
      return evalParamValueWithMemoisation(evalRecurseFull, value, event, event.count, noOptions)
    } finally {
      phase = outerPhase
    }
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
  
  // Shader nodes and texture sources pass through intact (like AudioNode): their fields
  // (build, acquire) must not be walked and called by object evaluation
  let shaderNode = {isShaderNode:true, build:()=>{ throw 'build must not be called' }}
  assert(true, evalParamFrame(()=>shaderNode, ev(0), 0) === shaderNode)
  assert(true, evalParamEvent(shaderNode, ev(0)) === shaderNode)
  let texSource = {isVisualTextureSource:true, acquire:()=>{ throw 'acquire must not be called' }}
  assert(true, evalParamFrame(()=>texSource, ev(0), 0) === texSource)

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
  assert({foo:{value:1,interval:'frame'},interval:'event'}, evalParamFrame(perEventThenFrameObject, ev(0), 1, {withInterval:true}))

  // a frame-tagged value that evaluates to a segment wrapper (a nested @f inside an @s timevar)
  // still gets the frame interval stamped, so audio-param routing can send it per frame
  let perFrameSegment = () => { return {value:5, _nextSegment:3, _segmentPower:1} }
  perFrameSegment.interval = 'frame'
  assert({value:5,_nextSegment:3,_segmentPower:1,interval:'frame'}, evalParamFrame(perFrameSegment, ev(0), 1, {withInterval:true}))

  let constWithMods = () => 1
  constWithMods.modifiers = {}
  assert(1, evalParamFrame(constWithMods, ev(0), 1))

  let seenExpanding
  let seesOptions = (e,b,er) => { seenExpanding = er.options && er.options.expandingChords; return 1 }
  seesOptions.modifiers = {}
  evalParamFrame(seesOptions, ev(0), 0, {expandingChords:true})
  assert(true, seenExpanding)

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

  { // Lambda-valued args pass through modifier evaluation uncalled
    let lambdaCalls = 0
    let fakeLambda = (e,b,er,args) => { lambdaCalls++; return 0 }
    fakeLambda.isUserFunction = true
    let received
    let fnWithLambdaArg = (e,b,er,mods) => { received = mods; return mods.x }
    fnWithLambdaArg.modifiers = {value:fakeLambda, x:3}
    assert(3, evalParamFrame(fnWithLambdaArg, ev(0), 0))
    assert(0, lambdaCalls)
    assert(true, received.value === fakeLambda)

    fnWithLambdaArg.modifiers = {value:fakeLambda, x:[1,2]} // Chord in a sibling arg still expands
    assert([1,2], evalParamFrame(fnWithLambdaArg, ev(1), 1))
    assert(0, lambdaCalls)
    assert(true, received.value === fakeLambda)
  }

  // The eval phase, which accum/smooth/rate key their running value on (functions/maths.js). The
  // event phase is sticky, because event time building evaluates sub-expressions with
  // evalParamFrame at the event's beat (draw/visualsynth/nodes.js, the audio node functions) - and
  // that is still the event's clock, not the live one.
  {
    let phaseProbe = (e,b) => evalPhase()
    let nested = (e,b) => evalParamFrame(phaseProbe, e, b)
    assert('frame', evalParamFrame(phaseProbe, ev(0), 0))
    assert('event', evalParamEvent(phaseProbe, ev(0)))
    assert('frame', evalParamFrame(nested, ev(0), 0))
    assert('event', evalParamEvent(nested, ev(0)))
    assert('frame', evalParamFrame(phaseProbe, ev(0), 0)) // restored afterwards
    let thrower = () => { throw new Error('boom') }
    try { evalParamEvent(thrower, ev(0)) } catch (e) {}
    assert('frame', evalParamFrame(phaseProbe, ev(0), 0)) // and restored even when one throws
  }

  { // Memo holds the event's own beat for the event's life, and only the latest other beat
    let calls = 0
    let counted = (e,b) => { calls++; return b }
    let e = ev(3)
    assert(3, evalParamFrame(counted, e, 3))
    for (let b = 3.1; b < 5; b += 0.1) { evalParamFrame(counted, e, b) }
    let memo = counted.__memo_event.get(e)
    assert(3, memo.event.beat)
    assert(true, memo.frame.beat > 4.8)
    assert(undefined, memo.frame.more)
    calls = 0
    evalParamFrame(counted, e, 3)
    assert(0, calls) // event beat still memoised
    evalParamFrame(counted, e, 7)
    evalParamFrame(counted, e, 7)
    assert(1, calls) // and the current frame beat
    evalParamFrame(counted, e, 8, {withInterval:true})
    assert(2, calls) // options are part of the key
  }
  { // A per event live input value stays frozen for the event, however often frames read it
    let live = 1
    let slider = () => live
    slider.isNonTemporal = true
    slider.interval = 'event'
    let e = ev(2)
    assert(1, evalParamFrame(slider, e, 2.5))
    live = 2
    assert(1, evalParamFrame(slider, e, 2.6))
    assert(1, evalParamEvent(slider, e))
    assert(2, evalParamFrame(slider, ev(3), 3.1)) // a new event reads the new value
  }
  { // Nested evaluation sees options passed in at the top, with or without them
    let seen = []
    let inner = (e,b,er) => { seen.push(!!(er.options && er.options.expandingChords)); return 1 }
    let outer = (e,b,er) => er(inner, e, b)
    evalParamFrame(outer, ev(0), 0, {expandingChords:true})
    evalParamFrame(outer, ev(1), 1)
    assert([true,false], seen)
  }
  assert({x:1,y:2}, evalParamFrame({x:()=>1,y:2}, ev(0), 0)) // No chord field: the object itself, not wrapped

  console.log('Eval param tests complete')
  }

  return {
    evalParamEvent:evalParamEvent,
    evalParamFrame:evalParamFrame,
    evalPhase:evalPhase,
    evalFunctionWithModifiers:evalFunctionWithModifiers,
  }

})
