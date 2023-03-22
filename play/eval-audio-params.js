'use strict';
define(function (require) {
  let system = require('play/system')
  let evalParam = require('player/eval-param')
  let {subParam,mainParam} = require('player/sub-param')

  let evalPerEvent = (params, p, def) => {
    let v = params[p]
    if (typeof v !== 'number' && !v) { return def }
    v =  evalParam.evalParamEvent(v, params) // Room for optimisation here: only eval objects the specific sub (or main) param thats needed for this call
    if (typeof v !== 'number' && !v) { return def }
    return v
  }

  let evalMainParamEvent = (params, p, def) => {
    let v = evalPerEvent(params, p, def)
    if (typeof v !== 'object') { return v }
    return mainParam(v, def)
  }

  let evalSubParamEvent = (params, p, subParamName, def) => {
    let v = evalPerEvent(params, p, def)
    if (typeof v !== 'object') { return def }
    return subParam(v, subParamName, def)
  }

  let evalPerFrame = (params, p, b, def) => {
    let v = params[p]
    v =  evalParam.evalParamFrame(v, params, b) // Room for optimisation here: only eval objects the specific sub (or main) param thats needed for this call
    if (typeof v !== 'number' && !v) {
      return def
    }
    return v
  }

  let evalMainPerFrame = (params, p, def, b) => {
    let v = evalPerFrame(params, p, b || params.count, def)
    if (typeof v !== 'object') { return v }
    return mainParam(v, def)
  }

  let evalSubPerFrame = (params, p, subParamName, def, b) => {
    let v = evalPerFrame(params, p, b || params.count, def)
    if (typeof v !== 'object') { return def }
    return subParam(v, subParamName, def)
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
        audioParam.linearRampToValueAtTime(v, system.timeNow()+2/60)
      }
    } catch (e) {
      console.log(audioParam, e)
      throw `Failed setting audio param ${p} to ${v}`
    }
  }

  let evalMainParamFrame = (audioParam, params, p, def, mod) => {
    let v = mainParam(params[p], def)
    if (typeof v == 'number') {
      // single value; no need for regular per frame update
      if (typeof mod === 'function') { v = mod(v) }
      audioParam.setValueAtTime(v, system.timeNow())
    } else {
      setAudioParamValue(audioParam, evalMainPerFrame(params, p, def, params.count), p, mod) // set now
      if (params._perFrame) {
        params._perFrame.push(state => rampAudioParamValue(audioParam, evalMainPerFrame(params, p, def, state.count), p, mod))
      } else {
        system.add(params._time, state => { // per frame update
          if (state.time > params.endTime) { return false }
          rampAudioParamValue(audioParam, evalMainPerFrame(params, p, def, state.count), p, mod)
          return true
        })
      }
    }
  }

  let fixedPerFrame = (params, p, subParamName, def) => {
    let v = subParam(params[p], subParamName, def)
     return typeof params[p] !== 'function' && typeof v == 'number'
  }

  let evalSubParamFrame = (audioParam, params, p, subParamName, def, mod) => {
    if (fixedPerFrame(params, p, subParamName, def)) {
      // single value; no need for regular per frame update
      let v = subParam(params[p], subParamName, def)
      if (typeof mod === 'function') { v = mod(v) }
      audioParam.setValueAtTime(v, system.timeNow())
    } else {
      setAudioParamValue(audioParam, evalSubPerFrame(params, p, subParamName, def, params.count), p, mod) // set now
      system.add(params._time, state => { // per frame update
        if (state.time > params.endTime) { return false }
        setAudioParamValue(audioParam, evalSubPerFrame(params, p, subParamName, def, state.count), p, mod)
        return true
      })
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

    assertAudioParam(2, false, (ap,mod)=>evalMainParamFrame(ap, {}, 'foo', 2, mod))
    assertAudioParam(3, false, (ap,mod)=>evalMainParamFrame(ap, {foo:3}, 'foo', 2, mod))
    assertAudioParam(2, false, (ap,mod)=>evalMainParamFrame(ap, {foo:undefined}, 'foo', 2, mod))
    assertAudioParam(3, false, (ap,mod)=>evalMainParamFrame(ap, {foo:{value:3,sub:4}}, 'foo', 2, mod))
    assertAudioParam(2, false, (ap,mod)=>evalMainParamFrame(ap, {foo:{value:undefined,sub:4}}, 'foo', 2, mod))
    assertAudioParam(3, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>3}, 'foo', 2, mod))
    assertAudioParam(2, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>undefined}, 'foo', 2, mod))
    assertAudioParam(3, true, (ap,mod)=>evalMainParamFrame(ap, {foo:{value:()=>3,sub:4}}, 'foo', 2, mod))
    assertAudioParam(3, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>{return {value:3,sub:4}}}, 'foo', 2, mod))
    assertAudioParam(2, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>{return {value:undefined,sub:4}}}, 'foo', 2, mod))
    assertAudioParam(3, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>{return {value:()=>3,sub:4}}}, 'foo', 2, mod))
    assertAudioParam(2, true, (ap,mod)=>evalMainParamFrame(ap, {foo:()=>{return {value:()=>undefined,sub:4}}}, 'foo', 2, mod))

    assertAudioParam(2, false, (ap,mod)=>evalSubParamFrame(ap, {}, 'foo', 'sub', 2, mod))
    assertAudioParam(2, false, (ap,mod)=>evalSubParamFrame(ap, {foo:3}, 'foo', 'sub', 2, mod))
    assertAudioParam(2, false, (ap,mod)=>evalSubParamFrame(ap, {foo:undefined}, 'foo', 'sub', 2, mod))
    assertAudioParam(4, false, (ap,mod)=>evalSubParamFrame(ap, {foo:{value:3,sub:4}}, 'foo', 'sub', 2, mod))
    assertAudioParam(2, false, (ap,mod)=>evalSubParamFrame(ap, {foo:{value:3,sub:undefined}}, 'foo', 'sub', 2, mod))
    assertAudioParam(2, true, (ap,mod)=>evalSubParamFrame(ap, {foo:()=>3}, 'foo', 'sub', 2, mod))
    assertAudioParam(2, true, (ap,mod)=>evalSubParamFrame(ap, {foo:()=>undefined}, 'foo', 'sub', 2, mod))
    assertAudioParam(4, true, (ap,mod)=>evalSubParamFrame(ap, {foo:{value:3,sub:()=>4}}, 'foo', 'sub', 2, mod))
    assertAudioParam(4, true, (ap,mod)=>evalSubParamFrame(ap, {foo:()=>{return {value:3,sub:4}}}, 'foo', 'sub', 2, mod))
    assertAudioParam(2, true, (ap,mod)=>evalSubParamFrame(ap, {foo:()=>{return {value:3,sub:undefined}}}, 'foo', 'sub', 2, mod))
    assertAudioParam(4, true, (ap,mod)=>evalSubParamFrame(ap, {foo:()=>{return {value:3,sub:()=>4}}}, 'foo', 'sub', 2, mod))
    assertAudioParam(2, true, (ap,mod)=>evalSubParamFrame(ap, {foo:()=>{return {value:3,sub:()=>undefined}}}, 'foo', 'sub', 2, mod))

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
    rampAudioParamValue: rampAudioParamValue,
  }
})
