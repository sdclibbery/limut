'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalParamEvent,evalParamFrame} = require('player/eval-param')
  let {mainParamUnits,subParamUnits} = require('player/sub-param')
  let {segmentedAudioParam} = require('play/segmented-audioparam')
  let metronome = require('metronome')
  let {connect,isConnectable} = require('play/node-connect');
  let {getCallTree,setCallTree,clearCallTree} = require('player/callstack')

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

  let setAudioParamValue = (audioParam, v, p, mod, t) => {
    try {
      if (v !== undefined) {
        if (typeof mod === 'function') { v = mod(v) }
        audioParam.setValueAtTime(v, t !== undefined ? t : system.timeNow())
      }
    } catch (e) {
      console.log(audioParam, e)
      throw `Failed setting audio param ${p} to ${v}`
    }
  }

  let updateStep = 1/60
  let perFrameUpdate = (audioParam, state, params, evalAt, mod, p) => {
    let __event = params !== undefined && params.__event ? params.__event : params
    if (__event && state.time > __event.endTime) { return false }
    if (__event && state.time < __event._time) { return true }
    if (audioParam.lastTime === undefined) {
      audioParam.lastTime = __event ? __event._time : system.timeNow()
    }
    while (audioParam.lastTime < state.time) {
      let count = metronome.beatTime(audioParam.lastTime+updateStep);
      let v = evalAt(count)
      if (v !== undefined) {
        if (typeof mod === 'function') { v = mod(v) }
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

  let evalMainParamFrame = (audioParam, params, p, def, requiredUnits, mod) => {
    let __event = params !== undefined && params.__event ? params.__event : params
    let vmp = mainParamUnits(params[p], requiredUnits, def)
    if (typeof vmp === 'number') { // single value; no need for regular per frame update
      setAudioParamValue(audioParam, vmp, p, mod, params._time)
    } else {
      if (segmentedAudioParam(audioParam, params, p, undefined, def, requiredUnits, mod)) { // Set up with a segmented timeline
        // if (params) { console.log(`Segmented audio update! Main ${params.player} ${p}`) }
        return
      }
      let evalled = evalParamFrame(params[p], __event,__event.count, {withInterval:true})
      let interval
      if (typeof evalled === 'object' && evalled.interval !== undefined && !isConnectable(evalled)) {
        interval = evalled.interval
        evalled = evalled.value
      }
      if (isConnectable(evalled)) { // Value is a node chain, just connect it
        // if (params) { console.log(`Connectable audio update! Main ${params.player} ${p}`) }
        audioParam.value = 0 // Remove any default value so we only get the value from the connection
        connect(evalled, audioParam, __event._destructor, {dont_disconnect_r:true})
        return
      }
      setAudioParamValue(audioParam, mainParamUnits(evalled, requiredUnits, def), p, mod, __event._time) // Set now
      if (interval === undefined) { // If it can't vary per frame, drop out here
        // if (params) { console.log(`Fixed audio update! Main ${params.player} ${p}`) }
        return
      }
      // if (params) { console.log(`Per frame audio update! Main ${params.player} ${p}`) }
      let args = getCallTree() // Remember the entire call tree at this point so it can be used for the per frame update
      let evalAt = (count) => {
        setCallTree(args)
        let r = evalMainPerFrame(params, p, def, count, requiredUnits)
        clearCallTree()
        return r
      }
      if (params._perFrame) { // Update callback for buses
        params._perFrame.push((state) => perFrameUpdate(audioParam, state, params, evalAt, mod, p))
      } else { // Update callback for normal players
        system.add(params._time, (state) => perFrameUpdate(audioParam, state, params, evalAt, mod, p))
      }
    }
  }

  let fixedPerFrame = (params, p, subParamName, def, requiredUnits) => {
    let v = params[p]
    if (typeof v === 'function') {
      v = evalParamFrame(v, params, params.count, {evalToObjectOrPrimitive:true})
      if (typeof v === 'object') { v = v[subParamName] }
      return v === undefined // If the whole param can vary, then only call this subparam fixed if its not set at all. Otherwise have to use per frame update
    }
    v = subParamUnits(v, subParamName, requiredUnits, def)
    return typeof v === 'number' || v === undefined
  }

  let evalSubParamFrame = (audioParam, params, p, subParamName, def, requiredUnits, mod) => {
    let v = subParamUnits(params[p], subParamName, requiredUnits, def)
    if (fixedPerFrame(params, p, subParamName, def, requiredUnits)) { // single value; no need for regular per frame update
      setAudioParamValue(audioParam, v, p, mod, params._time)
    } else {
      if (segmentedAudioParam(audioParam, params, p, subParamName, def, requiredUnits, mod)) { // Set up with a segmented timeline
        // if (params) { console.log(`Segmented audio update! Sub ${params.player} ${p} ${subParamName}`) }
        return
      }
      let evalled = evalPerFrame(params, p, params.count, def)
      setAudioParamValue(audioParam, subParamUnits(evalled, subParamName, requiredUnits, def), p, mod, params._time) // set now
      if (typeof v === 'function' && v.interval === 'event') { // If it can't vary per frame, drop out here
        // if (params) { console.log(`Fixed audio update! Sub ${params.player} ${p} ${subParamName}`) }
        return
      }
      // if (params) { console.log(`Per frame audio update! Sub ${params.player} ${p} ${subParamName}`) }
      let evalAt = (count) => evalSubPerFrame(params, p, subParamName, def, count, requiredUnits)
      if (params._perFrame) { // Update callback for buses
        params._perFrame.push(state => perFrameUpdate(audioParam, state, undefined, evalAt, mod, p))
      } else { // Update callback for normal players
        system.add(params._time, (state) => perFrameUpdate(audioParam, state, params, evalAt, mod, p))
      }
    }
  }

  let evalFuncFrame = (audioParam, params, name, fn) => {
    setAudioParamValue(audioParam, fn(params.count), name, params._time) // set now
    // if (params.player) { console.log(`Per frame audio update! ${params.player} ${name}`) }
    system.add(params._time, (state) => perFrameUpdate(audioParam, state, params, fn, undefined, name))
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
      let ap = {linearRampToValueAtTime:(v) => valueSet=v, setValueAtTime:(v) => valueSet=v, cancelScheduledValues:()=>{}}
      test(ap, mod)
      assert(expectedSystemAddCalled, called)
      assert(expected, valueSet)
      system.add = systemAdd
    }
    let assertAudioParam = (expected, expectedSystemAddCalled, test) => {
      assertAudioParamTest(expected, expectedSystemAddCalled, test, x => x)
      assertAudioParamTest(2*expected, expectedSystemAddCalled, test, x => 2*x)
    }
    let perF = (v) => { return {value:v,interval:'frame'}}

    assertAudioParam(2, false, (ap,mod)=>evalMainParamFrame(ap, {}, 'foo', 2, undefined, mod))
    assertAudioParam(3, false, (ap,mod)=>evalMainParamFrame(ap, {foo:3}, 'foo', 2, undefined, mod))
    assertAudioParam(2, false, (ap,mod)=>evalMainParamFrame(ap, {foo:undefined}, 'foo', 2, undefined, mod))
    assertAudioParam(3, false, (ap,mod)=>evalMainParamFrame(ap, {foo:{value:3,sub:4}}, 'foo', 2, undefined, mod))
    assertAudioParam(2, false, (ap,mod)=>evalMainParamFrame(ap, {foo:{value:undefined,sub:4}}, 'foo', 2, undefined, mod))
    assertAudioParam(3, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>perF(3)}, 'foo', 2, undefined, mod))
    assertAudioParam(2, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>perF(undefined)}, 'foo', 2, undefined, mod))
    assertAudioParam(3, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>{return perF({value:3,sub:4})}}, 'foo', 2, undefined, mod))
    assertAudioParam(2, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>{return perF({value:undefined,sub:4})}}, 'foo', 2, undefined, mod))
    assertAudioParam(3, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>{return perF({value:()=>3,sub:4})}}, 'foo', 2, undefined, mod))
    assertAudioParam(2, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>{return perF({value:()=>undefined,sub:4})}}, 'foo', 2, undefined, mod))

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
    assertAudioParam(3, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>{return perF({value:3})}}, 'foo', 2, 'hz', mod))
    assertAudioParam(1/3, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>{return perF({value:3,_units:'s'})}}, 'foo', 2, 'hz', mod))

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
