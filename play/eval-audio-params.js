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
    if (typeof v !== 'number' && !v) { return def }
    v =  evalParam.evalParamFrame(v, params, b) // Room for optimisation here: only eval objects the specific sub (or main) param thats needed for this call
    if (typeof v !== 'number' && !v) { return def }
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
        audioParam.value = v
      }
    } catch (e) {
      console.log(audioParam, e)
      throw `Failed setting audio param ${p} to ${v}`
    }
  }

  let evalPerFrameParam = (audioParam, params, p, def, evalMethod, mod) => {
    if (params[p] === undefined) {
      let v = def
      if (typeof mod === 'function') { v = mod(v) }
      audioParam.value = v
    } else if (typeof params[p] == 'number') {
      // single value; no need for regular per frame update
      let v = params[p]
      if (typeof mod === 'function') { v = mod(v) }
      audioParam.value = v
    } else {
      setAudioParamValue(audioParam, evalMethod(params.count), p, mod)
      system.add(params._time, state => {
        if (state.time > params.endTime) { return false }
        setAudioParamValue(audioParam, evalMethod(state.count), p, mod)
        return true
      })
    }
  }

  let evalMainParamFrame = (audioParam, params, p, def, mod) => {
    evalPerFrameParam(audioParam, params, p, def, (b) => evalMainPerFrame(params, p, def, b), mod)
  }

  let evalSubParamFrame = (audioParam, params, p, subParamName, def, mod) => {
    evalPerFrameParam(audioParam, params, p, def, (b) => evalSubPerFrame(params, p, subParamName, def, b), mod)
  }

  return {
    evalMainParamEvent: evalMainParamEvent,
    evalSubParamEvent: evalSubParamEvent,
    evalMainParamFrame: evalMainParamFrame,
    evalSubParamFrame: evalSubParamFrame,
  }
})
