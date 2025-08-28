'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalParamEvent,evalParamFrame} = require('player/eval-param')
  let {mainParamUnits,subParamUnits,mainParam,subParam} = require('player/sub-param')
  let {segmentedAudioParam,isSegmented} = require('play/segmented-audioparam')
  let metronome = require('metronome')
  let {connect,isConnectable} = require('play/nodes/connect');
  let {getCallTree,setCallTree,clearCallTree} = require('player/callstack')
  let {convertUnits,units} = require('units')

  let evalPerEvent = (params, p, def) => {
    let v = params[p]
    if (typeof v !== 'number' && !v) { return def }
    v =  evalParamEvent(v, params) // Room for optimisation here: only eval objects the specific sub (or main) param thats needed for this call
    if (Array.isArray(v)) { v = v[0] } // Bus chords end up as arrays here so handle it by just picking the first value
    if (typeof v !== 'number' && !v) { return def }
    return v
  }

  let evalMainParamEvent = (params, p, def, requiredUnits) => {
    let v = evalPerEvent(params, p, def)
    if (typeof v !== 'object') { return v }
    return mainParamUnits(v, requiredUnits, def)
  }

  let evalSubParamEvent = (params, p, subParamName, def, requiredUnits) => {
    let v = evalPerEvent(params, p, def)
    if (typeof v !== 'object') { return def }
    return subParamUnits(v, subParamName, requiredUnits, def)
  }

  let evalPerFrame = (params, p, b, def) => {
    let __event = params !== undefined && params.__event ? params.__event : params
    let v = params[p]
    v =  evalParamFrame(v, __event, b) // Room for optimisation here: only eval objects the specific sub (or main) param thats needed for this call
    if (Array.isArray(v)) { v = v[0] } // Bus chords end up as arrays here so handle it by just picking the first value
    if (isConnectable(v)) { return v } // Dont eval any further if this is a node chain
    if (typeof v !== 'number' && !v) {
      return def
    }
    return v
  }

  let evalMainPerFrame = (params, p, def, b, requiredUnits) => {
    let __event = params !== undefined && params.__event ? params.__event : params
    let v = evalPerFrame(params, p, b || __event.count, def)
    if (typeof v !== 'object') { return v }
    if (isConnectable(v)) { return v } // Dont eval any further if this is a node chain
    return mainParamUnits(v, requiredUnits, def)
  }

  let evalSubPerFrame = (params, p, subParamName, def, b, requiredUnits) => {
    let v = evalPerFrame(params, p, b || params.count, def)
    if (typeof v !== 'object') { return def }
    if (isConnectable(v)) { return v } // Dont eval any further if this is a node chain
    return subParamUnits(v, subParamName, requiredUnits, def)
  }

  let perFrameUpdate = (audioParam, state, params, evalAt, p) => {
    let __event = params !== undefined && params.__event ? params.__event : params
    if (__event && state.time > __event.endTime) { return false }
    if (__event && state.time < __event._time) { return true }
    if (audioParam.lastTime === undefined) {
      audioParam.lastTime = (__event && __event._time) ? __event._time : system.timeNow()
    }
    while (audioParam.lastTime < state.time) {
      let count = metronome.beatTime(audioParam.lastTime+updateStep);
      let v = evalAt(count)
      if (v !== undefined) {
        try {
          audioParam.setTargetAtTime(v, audioParam.lastTime, updateStep/4)
        } catch (e) {
          console.log(audioParam, e)
          throw `Failed updating audio param ${p} to ${v}`
        }
      }
      audioParam.lastTime += updateStep
    }
    return true
  }              

  let evalFuncFrame = (audioParam, params, name, fn) => {
    setAudioParamValue(audioParam, fn(params.count), name, params._time) // set now
    // if (params.player) { console.log(`Per frame audio update! ${params.player} ${name}`) }
    system.add(params._time, (state) => perFrameUpdate(audioParam, state, params, fn, name))
  }

  let fixedPerFrame = (params, p, subParamName, def, requiredUnits) => { // ???Should this use {withInterval:true}?
    let v = params[p]
    if (typeof v === 'function') {
      v = evalParamFrame(v, params, params.count, {evalToObjectOrPrimitive:true})
      if (typeof v === 'object') { v = v[subParamName] }
      return v === undefined // If the whole param can vary, then only call this subparam fixed if its not set at all. Otherwise have to use per frame update
    }
    v = subParamUnits(v, subParamName, requiredUnits, def)
    return typeof v === 'number' || v === undefined
  }

  let setAudioParamValue = (audioParam, v, p, mod, t) => {
    try {
      if (v !== undefined) {
        if (typeof mod === 'function') { v = mod(v) }
        audioParam.setValueAtTime(v, t !== undefined ? t : system.timeNow())
      }
    } catch (e) {
      console.log(audioParam, v, t, e)
      throw `Failed setting audio param ${p} to ${v}`
    }
  }

  let updateStep = 1/60
  let doPerFrame = (audioParam, __event, params, p, isParamSegmented, def, requiredUnits, subParamName, mod) => {
    let initial = true // When evalling from this callstack, no need to set the call tree
    let args = getCallTree() // Remember the entire call tree at this point so it can be used for the per frame update
    let evalAt = (count) => {
      if (!initial) { setCallTree(args) } // Use call tree if this involves a user defined function
      let v =  evalParamFrame(params[p], __event, count)
      if (!initial) { clearCallTree() }
      return v
    }
    let perFrame // The actual per frame callback
    if (isParamSegmented) {
      segmentedAudioParam(audioParam, evalAt, __event, subParamName, def, requiredUnits, mod) // Give it a call right now
      perFrame = (state) => false//segmentedAudioParam(audioParam, evalAt, __event, undefined, def, requiredUnits, mod)
    } else {
      perFrame = (state) => {
        if (__event && state.time > __event.endTime) { return false } // Finished
        if (__event && state.time < __event._time) { return true } // Not started yet
        if (audioParam.lastTime === undefined) {
          audioParam.lastTime = (__event && __event._time !== undefined) ? __event._time : system.timeNow()
        }
        while (audioParam.lastTime < state.time) { // Make a fixed size timestep
          let count = metronome.beatTime(audioParam.lastTime+updateStep)
          let v = evalAt(count)
          let unit
          if (typeof v === 'object') {
            if (subParamName) {
              v = v[subParamName]
            } else {
              if (v._units) { unit = v._units }
              if (v.value !== undefined) { v = v.value }
            }
          }
          if (typeof v === 'object') {
            if (v._units) { unit = v._units }
            if (v.value !== undefined) { v = v.value }
          }
          if (unit) { v = convertUnits(v, unit, requiredUnits) }
          if (v === undefined) { v = def }
          if (typeof mod === 'function') { v = mod(v) }
          try {
            audioParam.setTargetAtTime(v, audioParam.lastTime+updateStep, updateStep/4)
          } catch (e) {
            console.log(audioParam, v, e)
            throw `Failed updating audio param ${p} to ${v}`
          }
          audioParam.lastTime += updateStep
        }
        return true
      }
    }
    if (params._perFrame) { // Update callback for buses
      params._perFrame.push(perFrame)
    } else { // Update callback for normal players
      system.add(params._time, perFrame)
    }
    initial = false
  }

  let evalParamPerFrame = (audioParam, params, p, def, requiredUnits, subParamName, mod) => {
    let __event = params !== undefined && params.__event ? params.__event : params
    let value = params[p]
    value = evalParamFrame(params[p], __event,__event.count, {withInterval:true})
    let isParamSegmented = isSegmented(value)
    let interval
    let unit
// console.log('1', p, value, subParamName, params)
    if (typeof value === 'object') {
      if (!subParamName && value.interval) { interval = value.interval }
      if (isSegmented(value)) { isParamSegmented = true }
      if (subParamName) {
        value = value[subParamName]
      } else {
        if (value._units) { unit = value._units }
        if (value.value !== undefined && value.value1 === undefined) { value = value.value }
      }
    } else {
      if (subParamName) { value = undefined } // If its not an object, there can't be a subparam
    }
// console.log('2', value)
    if (typeof value === 'object') {
      if (value.interval) { interval = value.interval }
      if (isSegmented(value)) { isParamSegmented = true }
      if (value._units) { unit = value._units }
      if (value.value !== undefined && value.value1 === undefined) { value = value.value }
    }
// console.log('3', value, isConnectable(value))
    if (isConnectable(value)) { // Value is a node chain, just connect it
      audioParam.value = 0 // Remove any default value so we only get the value from the connection
      connect(value, audioParam, __event._destructor, {dont_disconnect_r:true})
      return
    }
// console.log('4', value, unit, interval, requiredUnits, isParamSegmented)
    if (unit) { value = convertUnits(value, unit, requiredUnits) }
    if (value === undefined) { value = def }
// console.log('5', value)
    if (!isParamSegmented)  {
      setAudioParamValue(audioParam, value, p, mod, params._time) // Set value now
    }
    if (interval === 'frame' || isParamSegmented) {
      doPerFrame(audioParam, __event, params, p, isParamSegmented, def, requiredUnits, subParamName, mod)
      return
    }
  }

  let evalMainParamFrame = (audioParam, params, p, def, requiredUnits, mod) => {
    return evalParamPerFrame(audioParam, params, p, def, requiredUnits, undefined, mod)
  }

  let evalSubParamFrame = (audioParam, params, p, subParamName, def, requiredUnits, mod) => {
    return evalParamPerFrame(audioParam, params, p, def, requiredUnits, subParamName, mod)
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual, message) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.00001).toFixed(4) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.00001).toFixed(4) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}\n ${message || ''}`) }
    }

    assert(2, evalMainParamEvent({}, 'foo', 2))
    assert(3, evalMainParamEvent({foo:3}, 'foo', 2))
    assert('3', evalMainParamEvent({foo:'3'}, 'foo', '2'))
    assert(2, evalMainParamEvent({foo:undefined}, 'foo', 2))
    assert(3, evalMainParamEvent({foo:{value:3,sub:4}}, 'foo', 2))
    assert(2, evalMainParamEvent({foo:{value:undefined,sub:4}}, 'foo', 2))
    assert(3, evalMainParamEvent({foo:()=>3}, 'foo', 2))
    assert(2, evalMainParamEvent({foo:()=>undefined}, 'foo', 2))
    assert(3, evalMainParamEvent({foo:{value:()=>3,sub:4}}, 'foo', 2))
    assert(3, evalMainParamEvent({foo:()=>{return {value:3,sub:4}}}, 'foo', 2))
    assert(2, evalMainParamEvent({foo:()=>{return {value:undefined,sub:4}}}, 'foo', 2))
    assert(3, evalMainParamEvent({foo:()=>{return {value:()=>3,sub:4}}}, 'foo', 2))

    assert(2, evalSubParamEvent({}, 'foo', 'sub', 2))
    assert(2, evalSubParamEvent({foo:3}, 'foo', 'sub', 2))
    assert(4, evalSubParamEvent({foo:{value:3,sub:4}}, 'foo', 'sub', 2))
    assert('4', evalSubParamEvent({foo:{value:3,sub:'4'}}, 'foo', 'sub', '2'))
    assert(2, evalSubParamEvent({foo:{value:3,sub:undefined}}, 'foo', 'sub', 2))
    assert(2, evalSubParamEvent({foo:()=>3}, 'foo', 'sub', 2))
    assert(4, evalSubParamEvent({foo:{value:()=>3,sub:4}}, 'foo', 'sub', 2))
    assert(4, evalSubParamEvent({foo:()=>{return {value:3,sub:4}}}, 'foo', 'sub', 2))
    assert(2, evalSubParamEvent({foo:()=>{return {value:3,sub:undefined}}}, 'foo', 'sub', 2))
    assert(4, evalSubParamEvent({foo:()=>{return {value:3,sub:()=>4}}}, 'foo', 'sub', 2))
    assert(2, evalSubParamEvent({foo:()=>{return {value:3,sub:()=>undefined}}}, 'foo', 'sub', 2))
  
    let mockAp = () => {
      let calls = []
      return {
        calls: calls,
        cancelScheduledValues: (...args) => calls.push(['cancelScheduledValues'].concat(args)),
        setValueAtTime: (...args) => calls.push(['setValueAtTime'].concat(args)),
        linearRampToValueAtTime: (...args) => calls.push(['linearRampToValueAtTime'].concat(args)),
        exponentialRampToValueAtTime: (...args) => calls.push(['exponentialRampToValueAtTime'].concat(args)),
        setTargetAtTime: (...args) => calls.push(['setTargetAtTime'].concat(args)),
        setValueCurveAtTime: (...args) => calls.push(['setValueCurveAtTime'].concat(args)),
      }
    }
    let assertApCalls = (expected, ap) => {
      assert(expected.length, ap.calls.length, `Expected ${expected}, but got ${ap.calls}`)
      for (let i = 0; i < expected.length; i++) {
        assert(expected[i], ap.calls[i], `index: ${i}`)
      }
    }
    let p = (params) => { params._time = 0; return params }
    let ap
    let pf
    let f
    let hz = (v) => { return {value:v,_units:'hz'} }
    let s = (v) => { return {value:v,_units:'s'} }
    let oldBeatDuration = metronome.beatDuration()
    metronome.beatDuration(2)

    // const number
    ap = mockAp(); evalMainParamFrame(ap, p({}), 'foo', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 6,0]], ap)
    ap = mockAp(); evalMainParamFrame(ap, p({foo:2}), 'foo', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 4,0]], ap)
    ap = mockAp(); evalMainParamFrame(ap, p({foo:{value:2,bar:0}}), 'foo', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 4,0]], ap)
    ap = mockAp(); evalMainParamFrame(ap, p({foo:{value:2,bar:s(0)}}), 'foo', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 4,0]], ap)
    ap = mockAp(); evalSubParamFrame(ap, p({}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 6,0]], ap)
    ap = mockAp(); evalSubParamFrame(ap, p({foo:0}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 6,0]], ap)
    ap = mockAp(); evalSubParamFrame(ap, p({foo:{value:0}}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 6,0]], ap)
    ap = mockAp(); evalSubParamFrame(ap, p({foo:{value:0,bar:2}}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 4,0]], ap)
    ap = mockAp(); evalSubParamFrame(ap, p({foo:{value:0,_units:'s',bar:2}}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 4,0]], ap)

    // const number with units
    ap = mockAp(); evalMainParamFrame(ap, p({foo:{value:2,_units:'s'}}), 'foo', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 1,0]], ap)
    ap = mockAp(); evalMainParamFrame(ap, p({foo:{value:2,_units:'s',bar:s(0)}}), 'foo', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 1,0]], ap)
    ap = mockAp(); evalSubParamFrame(ap, p({foo:{value:0,_units:'s',bar:{value:2,_units:'s'}}}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 1,0]], ap)

    // function returns const number
    ap = mockAp(); evalMainParamFrame(ap, p({foo:()=>undefined}), 'foo', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 6,0]], ap)
    ap = mockAp(); evalMainParamFrame(ap, p({foo:()=>2}), 'foo', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 4,0]], ap)
    ap = mockAp(); evalMainParamFrame(ap, p({foo:()=>()=>2}), 'foo', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 4,0]], ap)
    ap = mockAp(); evalMainParamFrame(ap, p({foo:()=>{return{value:2,bar:0}}}), 'foo', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 4,0]], ap)
    ap = mockAp(); evalMainParamFrame(ap, p({foo:()=>{return{value:2,bar:s(0)}}}), 'foo', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 4,0]], ap)
    ap = mockAp(); evalMainParamFrame(ap, p({foo:()=>{return{value:()=>2,bar:s(0)}}}), 'foo', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 4,0]], ap)
    ap = mockAp(); evalSubParamFrame(ap, p({foo:()=>undefined}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 6,0]], ap)
    ap = mockAp(); evalSubParamFrame(ap, p({foo:()=>s(0)}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 6,0]], ap)
    ap = mockAp(); evalSubParamFrame(ap, p({foo:{value:0,_units:'s',bar:()=>undefined}}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 6,0]], ap)
    ap = mockAp(); evalSubParamFrame(ap, p({foo:{value:0,_units:'s',bar:()=>2}}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 4,0]], ap)
    ap = mockAp(); evalSubParamFrame(ap, p({foo:()=>{return{value:0,bar:()=>2}}}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 4,0]], ap)
    ap = mockAp(); evalSubParamFrame(ap, p({foo:()=>{return{value:0,_units:'s',bar:()=>2}}}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 4,0]], ap)

    // function returns const number with units
    ap = mockAp(); evalMainParamFrame(ap, p({foo:()=>s(2)}), 'foo', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 1,0]], ap)
    ap = mockAp(); evalMainParamFrame(ap, p({foo:()=>()=>s(2)}), 'foo', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 1,0]], ap)
    ap = mockAp(); evalMainParamFrame(ap, p({foo:()=>{return{value:2,_units:'s',bar:s(0)}}}), 'foo', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 1,0]], ap)
    ap = mockAp(); evalMainParamFrame(ap, p({foo:()=>{return{value:()=>s(2),bar:s(0)}}}), 'foo', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 1,0]], ap)
    ap = mockAp(); evalSubParamFrame(ap, p({foo:{value:0,_units:'s',bar:()=>s(2)}}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 1,0]], ap)
    ap = mockAp(); evalSubParamFrame(ap, p({foo:()=>{return{value:0,_units:'s',bar:()=>s(2)}}}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    assertApCalls([['setValueAtTime', 1,0]], ap)

    // function returns segmented value
    let {eventTimeVar} = require('expression/eval-timevars')
    let u2 = [undefined,undefined]
    let e = eventTimeVar([hz(8),hz(9)], u2, u2, 1, true)
    ap = mockAp(); pf = []; evalMainParamFrame(ap, {foo:e, _perFrame:pf, count:1, dur:4, _time:2, endTime:10}, 'foo', 3, 'hz', (v) => v * 2)
    pf[0]({time:2})
    assertApCalls([
      ['setValueAtTime', 16,0], ['setValueAtTime', 16,2],
      ['linearRampToValueAtTime', 18,4], ['setValueAtTime',18,4]
    ], ap)
    ap = mockAp(); pf = []; evalMainParamFrame(ap, {foo:{value:e,poles:4}, _perFrame:pf, count:1, dur:4, _time:2, endTime:10}, 'foo', 3, 'hz', (v) => v * 2)
    pf[0]({time:2})
    assertApCalls([
      ['setValueAtTime', 16,0], ['setValueAtTime', 16,2],
      ['linearRampToValueAtTime', 18,4], ['setValueAtTime',18,4]
    ], ap)
    ap = mockAp(); pf = []; evalSubParamFrame(ap, {foo:{value:0,_units:'hz',bar:e}, _perFrame:pf, count:1, dur:4, _time:2, endTime:10}, 'foo', 'bar', 3, 'hz', (v) => v * 2)
    pf[0]({time:2})
    assertApCalls([
      ['setValueAtTime', 16,0], ['setValueAtTime', 16,2],
      ['linearRampToValueAtTime', 18,4], ['setValueAtTime',18,4]
    ], ap)

    // function returns segmented value with units
    e = eventTimeVar([s(8),s(9)], u2, u2, 1, true)
    ap = mockAp(); pf = []; evalMainParamFrame(ap, {foo:e, _perFrame:pf, count:1, dur:4, _time:2, endTime:10}, 'foo', 3, 'hz', (v) => v * 2)
    pf[0]({time:2})
    assertApCalls([
      ['setValueAtTime', 1/4,0], ['setValueAtTime', 1/4,2],
      ['linearRampToValueAtTime', 2/9,4], ["setValueAtTime",2/9,4]
    ], ap)
    ap = mockAp(); pf = []; evalSubParamFrame(ap, {foo:{value:0,_units:'hz',bar:e}, _perFrame:pf, count:1, dur:4, _time:2, endTime:10}, 'foo', 'bar', 3, 'hz', (v) => v * 2)
    pf[0]({time:2})
    assertApCalls([
      ['setValueAtTime', 1/4,0], ['setValueAtTime', 1/4,2],
      ['linearRampToValueAtTime', 2/9,4], ["setValueAtTime",2/9,4]
    ], ap)

    // function returns per frame value
    f = () => 2
    f.interval = 'frame'
    ap = mockAp(); pf = []; evalMainParamFrame(ap, p({foo:f,_perFrame:pf}), 'foo', 3, 'hz', (v) => v * 2)
    pf[0]({time:1/60}); assertApCalls([ ['setValueAtTime', 4,0], ['setTargetAtTime', 4,1/60,1/240] ], ap)
    ap = mockAp(); pf = []; evalSubParamFrame(ap, p({foo:f,_perFrame:pf}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    assert(0, pf.length); assertApCalls([ ['setValueAtTime', 6,0] ], ap)
    ap = mockAp(); pf = []; evalSubParamFrame(ap, p({foo:{value:0,_units:'s',bar:f},_perFrame:pf}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    pf[0]({time:1/60}); assertApCalls([ ['setValueAtTime', 4,0], ['setTargetAtTime', 4,1/60,1/240] ], ap)

    // function returns per frame value with units
    f = () => s(2)
    f.interval = 'frame'
    ap = mockAp(); pf = []; evalMainParamFrame(ap, p({foo:f,_perFrame:pf}), 'foo', 3, 'hz', (v) => v * 2)
    pf[0]({time:1/60}); assertApCalls([ ['setValueAtTime', 1,0], ['setTargetAtTime', 1,1/60,1/240] ], ap)
    ap = mockAp(); pf = []; evalSubParamFrame(ap, p({foo:{value:0,_units:'s',bar:f},_perFrame:pf}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    pf[0]({time:1/60}); assertApCalls([ ['setValueAtTime', 1,0], ['setTargetAtTime', 1,1/60,1/240] ], ap)

    // per frame function returns param
    f = () => { return {value:0,_units:'s',bar:2} }
    f.interval = 'frame'
    ap = mockAp(); pf = []; evalSubParamFrame(ap, p({foo:f,_perFrame:pf}), 'foo', 'bar', 3, 'hz', (v) => v * 2)
    assert(0, pf.length); assertApCalls([ ['setValueAtTime', 4,0] ], ap)

    // user functions that require a call tree to be saved - tested in parse-expression tests

    // connectables - tested in parse-expression tests

    metronome.beatDuration(oldBeatDuration)
    console.log('Eval audio param tests complete')
  }

  return {
    evalMainParamEvent: evalMainParamEvent,
    evalSubParamEvent: evalSubParamEvent,
    evalMainParamFrame: evalMainParamFrame,
    evalSubParamFrame: evalSubParamFrame,
    evalMainPerFrame: evalMainPerFrame,
    evalSubPerFrame: evalSubPerFrame,
    fixedPerFrame: fixedPerFrame,
    setAudioParamValue: setAudioParamValue,
    evalFuncFrame: evalFuncFrame,
  }
})
