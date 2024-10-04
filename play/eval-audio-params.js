'use strict';
define(function (require) {
  let system = require('play/system')
  let evalParam = require('player/eval-param')
  let {mainParamUnits,subParamUnits} = require('player/sub-param')
  let {segmentedAudioParam} = require('play/segmented-audioparam')
  let metronome = require('metronome')

  let evalPerEvent = (params, p, def) => {
    let v = params[p]
    if (typeof v !== 'number' && !v) { return def }
    v =  evalParam.evalParamEvent(v, params) // Room for optimisation here: only eval objects the specific sub (or main) param thats needed for this call
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
    let v = params[p]
    v =  evalParam.evalParamFrame(v, params, b) // Room for optimisation here: only eval objects the specific sub (or main) param thats needed for this call
    if (Array.isArray(v)) { v = v[0] } // Bus chords end up as arrays here so handle it by just picking the first value
    if (typeof v !== 'number' && !v) {
      return def
    }
    return v
  }

  let evalMainPerFrame = (params, p, def, b, requiredUnits) => {
    let v = evalPerFrame(params, p, b || params.count, def)
    if (typeof v !== 'object') { return v }
    return mainParamUnits(v, requiredUnits, def)
  }

  let evalSubPerFrame = (params, p, subParamName, def, b, requiredUnits) => {
    let v = evalPerFrame(params, p, b || params.count, def)
    if (typeof v !== 'object') { return def }
    return subParamUnits(v, subParamName, requiredUnits, def)
  }

  let setAudioParamValue = (audioParam, v, p, mod) => {
    try {
      if (v !== undefined) {
        if (typeof mod === 'function') { v = mod(v) }
        audioParam.setValueAtTime(v, system.timeNow())
      }
    } catch (e) {
      console.log(audioParam, e)
      throw `Failed setting audio param ${p} to ${v}`
    }
  }

  let rampAudioParamValue = (audioParam, v, p, mod) => {
    try {
      if (v !== undefined) {
        if (typeof mod === 'function') { v = mod(v) }
v = Math.abs(v)
        // audioParam.setTargetAtTime(v, system.timeNow(), 1/240)
        audioParam.linearRampToValueAtTime(v, system.timeNow()+2/60)
}    } catch (e) {
      console.log(audioParam, e)
      throw `Failed setting audio param ${p} to ${v}`
    }
  }

  let evalMainParamFrame = (audioParam, params, p, def, requiredUnits, mod) => {
    let v = mainParamUnits(params[p], requiredUnits, def)
    if (typeof v === 'number') {
      // single value; no need for regular per frame update
      if (typeof mod === 'function') { v = mod(v) }
      audioParam.setValueAtTime(v, system.timeNow())
    } else {
      if (segmentedAudioParam(audioParam, params, p, undefined, def, requiredUnits, mod)) { return } // Set up with a segmented timeline

      // setAudioParamValue(audioParam, evalMainPerFrame(params, p, def, params.count, requiredUnits), p, mod) // set now
      let v = evalMainPerFrame(params, p, def, params.count, requiredUnits)
      if (v !== undefined) {
        if (typeof mod === 'function') { v = mod(v) }
v = Math.abs(v)
        audioParam.setValueAtTime(v, params._time) // Set at start time, not current time
      }

      if (params.player) { console.log(`Per frame audio update! ${params.player} ${p}`) }
      if (params._perFrame) {
        params._perFrame.push(state => rampAudioParamValue(audioParam, evalMainPerFrame(params, p, def, state.count, requiredUnits), p, mod))
      } else {
        let lastTime = params._time
        let updateStep = 1/60
        system.add(params._time, state => { // per frame update
          if (state.time > params.endTime) { return false }
          // rampAudioParamValue(audioParam, evalMainPerFrame(params, p, def, state.count, requiredUnits), p, mod)

          if (state.time < params._time) { return true }
          while (lastTime < state.time) {
            let count = metronome.beatTime(lastTime+updateStep);
            let v = evalMainPerFrame(params, p, def, count, requiredUnits)
            if (v !== undefined) {
              if (typeof mod === 'function') { v = mod(v) }
v = Math.abs(v)
              audioParam.setTargetAtTime(v, lastTime, updateStep/16)
            }
            lastTime += updateStep
          }

          return true
        })
      }
    }
  }

  let fixedPerFrame = (params, p, subParamName, def, requiredUnits) => {
    let v = params[p]
    if (typeof v === 'function') {
      v = evalParam.evalParamToObjectOrPrimitive(v, params, params.count)
      if (typeof v === 'object') { v = v[subParamName] }
      return v === undefined // If the whole param can vary, then only call this subparam fixed if its not set at all. Otherwise have to use per frame update
    }
    v = subParamUnits(v, subParamName, requiredUnits, def)
    return typeof v === 'number' || v === undefined
  }

  let evalSubParamFrame = (audioParam, params, p, subParamName, def, requiredUnits, mod) => {
    if (fixedPerFrame(params, p, subParamName, def, requiredUnits)) {
      // single value; no need for regular per frame update
      let v = subParamUnits(params[p], subParamName, requiredUnits, def)
      if (typeof mod === 'function') { v = mod(v) }
      audioParam.setValueAtTime(v, system.timeNow())
    } else {
      if (segmentedAudioParam(audioParam, params, p, subParamName, def, requiredUnits, mod)) { return } // Set up with a timeline
      setAudioParamValue(audioParam, evalSubPerFrame(params, p, subParamName, def, params.count, requiredUnits), p, mod) // set now
      if (params.player) { console.log(`Per frame audio update! ${params.player} ${p} ${subParamName}`) }
      if (params._perFrame) {
        params._perFrame.push(state => rampAudioParamValue(audioParam, evalSubPerFrame(params, p, subParamName, def, state.count, requiredUnits), p, mod))
      } else {
        system.add(params._time, state => { // per frame update
          if (state.time > params.endTime) { return false }
          rampAudioParamValue(audioParam, evalSubPerFrame(params, p, subParamName, def, state.count, requiredUnits), p, mod)
          return true
        })
      }
    }
  }

  let evalFuncFrame = (audioParam, params, name, fn) => {
    setAudioParamValue(audioParam, fn(params.count), name) // set now
    system.add(params._time, state => { // per frame update
      if (state.time > params.endTime) { return false }
      rampAudioParamValue(audioParam, fn(state.count), name)
      return true
    })
}

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
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
  
    let assertAudioParamTest = (expected, expectedSystemAddCalled, test, mod) => {
      let systemAdd = system.add
      let called = false
      let valueSet = undefined
      system.add = () => called=true
      let ap = {linearRampToValueAtTime:(v) => valueSet=v,setValueAtTime:(v) => valueSet=v}
      test(ap, mod)
      assert(expectedSystemAddCalled, called)
      assert(expected, valueSet)
      system.add = systemAdd
    }
    let assertAudioParam = (expected, expectedSystemAddCalled, test) => {
      assertAudioParamTest(expected, expectedSystemAddCalled, test, x => x)
      assertAudioParamTest(2*expected, expectedSystemAddCalled, test, x => 2*x)
    }

    assertAudioParam(2, false, (ap,mod)=>evalMainParamFrame(ap, {}, 'foo', 2, undefined, mod))
    assertAudioParam(3, false, (ap,mod)=>evalMainParamFrame(ap, {foo:3}, 'foo', 2, undefined, mod))
    assertAudioParam(2, false, (ap,mod)=>evalMainParamFrame(ap, {foo:undefined}, 'foo', 2, undefined, mod))
    assertAudioParam(3, false, (ap,mod)=>evalMainParamFrame(ap, {foo:{value:3,sub:4}}, 'foo', 2, undefined, mod))
    assertAudioParam(2, false, (ap,mod)=>evalMainParamFrame(ap, {foo:{value:undefined,sub:4}}, 'foo', 2, undefined, mod))
    assertAudioParam(3, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>3}, 'foo', 2, undefined, mod))
    assertAudioParam(2, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>undefined}, 'foo', 2, undefined, mod))
    assertAudioParam(3, true, (ap,mod)=>evalMainParamFrame(ap, {foo:{value:()=>3,sub:4}}, 'foo', 2, undefined, mod))
    assertAudioParam(3, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>{return {value:3,sub:4}}}, 'foo', 2, undefined, mod))
    assertAudioParam(2, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>{return {value:undefined,sub:4}}}, 'foo', 2, undefined, mod))
    assertAudioParam(3, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>{return {value:()=>3,sub:4}}}, 'foo', 2, undefined, mod))
    assertAudioParam(2, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>{return {value:()=>undefined,sub:4}}}, 'foo', 2, undefined, mod))

    assertAudioParam(2, false, (ap,mod)=>evalSubParamFrame(ap, {}, 'foo', 'sub', 2, undefined, mod))
    assertAudioParam(2, false, (ap,mod)=>evalSubParamFrame(ap, {foo:3}, 'foo', 'sub', 2, undefined, mod))
    assertAudioParam(2, false, (ap,mod)=>evalSubParamFrame(ap, {foo:undefined}, 'foo', 'sub', 2, undefined, mod))
    assertAudioParam(4, false, (ap,mod)=>evalSubParamFrame(ap, {foo:{value:3,sub:4}}, 'foo', 'sub', 2, undefined, mod))
    assertAudioParam(2, false, (ap,mod)=>evalSubParamFrame(ap, {foo:{value:3,sub:undefined}}, 'foo', 'sub', 2, undefined, mod))
    assertAudioParam(2, true, (ap,mod)=>evalSubParamFrame(ap, {foo:()=>3}, 'foo', 'sub', 2, undefined, mod))
    assertAudioParam(2, false, (ap,mod)=>evalSubParamFrame(ap, {foo:()=>undefined}, 'foo', 'sub', 2, undefined, mod))
    assertAudioParam(4, true, (ap,mod)=>evalSubParamFrame(ap, {foo:{value:3,sub:()=>4}}, 'foo', 'sub', 2, undefined, mod))
    assertAudioParam(4, true, (ap,mod)=>evalSubParamFrame(ap, {foo:()=>{return {value:3,sub:4}}}, 'foo', 'sub', 2, undefined, mod))
    assertAudioParam(2, false, (ap,mod)=>evalSubParamFrame(ap, {foo:()=>{return {value:3,sub:undefined}}}, 'foo', 'sub', 2, undefined, mod))
    assertAudioParam(4, true, (ap,mod)=>evalSubParamFrame(ap, {foo:()=>{return {value:3,sub:()=>4}}}, 'foo', 'sub', 2, undefined, mod))
    assertAudioParam(2, true, (ap,mod)=>evalSubParamFrame(ap, {foo:()=>{return {value:3,sub:()=>undefined}}}, 'foo', 'sub', 2, undefined, mod))

    assertAudioParam(3, false, (ap,mod)=>evalMainParamFrame(ap, {foo:3}, 'foo', 2, 'hz', mod))
    assertAudioParam(3, false, (ap,mod)=>evalMainParamFrame(ap, {foo:{value:3}}, 'foo', 2, 'hz', mod))
    assertAudioParam(1/3, false, (ap,mod)=>evalMainParamFrame(ap, {foo:{value:3,_units:'s'}}, 'foo', 2, 'hz', mod))
    assertAudioParam(3, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>{return{value:3}}}, 'foo', 2, 'hz', mod))
    assertAudioParam(1/3, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>{return{value:3,_units:'s'}}}, 'foo', 2, 'hz', mod))

    assertAudioParam(3, false, (ap,mod)=>evalSubParamFrame(ap, {foo:{sub:3}}, 'foo', 'sub', 2, 'hz', mod))
    assertAudioParam(3, false, (ap,mod)=>evalSubParamFrame(ap, {foo:{sub:{value:3}}}, 'foo', 'sub', 2, 'hz', mod))
    assertAudioParam(1/3, false, (ap,mod)=>evalSubParamFrame(ap, {foo:{sub:{value:3,_units:'s'}}}, 'foo', 'sub', 2, 'hz', mod))
    assertAudioParam(3, true, (ap,mod)=>evalSubParamFrame(ap, {foo:()=>{return{sub:{value:3}}}}, 'foo', 'sub', 2, 'hz', mod))
    assertAudioParam(1/3, true, (ap,mod)=>evalSubParamFrame(ap, {foo:()=>{return{sub:{value:3,_units:'s'}}}}, 'foo', 'sub', 2, 'hz', mod))

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
