'use strict';
define(function (require) {
  let system = require('play/system')
  let evalParam = require('player/eval-param').evalParamFrame
  let {subParam,mainParam} = require('player/sub-param')

  let evalParamNow = (params, p, b, def) => {
    let v = params[p]
    if (typeof v !== 'number' && !v) { return def }
    v =  evalParam(v, params, b) // Room for optimisation here: only eval objects the specific sub (or main) param thats needed for this call
    if (typeof v !== 'number' && !v) { return def }
    return v
  }

  let evalMainParamNow = (params, p, def, b) => {
    let v = evalParamNow(params, p, b || params.count, def)
    if (typeof v !== 'object') { return v }
    return mainParam(v, def)
  }

  let evalSubParamNow = (params, p, subParamName, def, b) => {
    let v = evalParamNow(params, p, b || params.count, def)
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
      audioParam.value = def
    } else if (typeof params[p] == 'number') {
      // single value; no need for regular per frame update
      audioParam.value = params[p]
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
    evalPerFrameParam(audioParam, params, p, def, (b) => evalMainParamNow(params, p, def, b), mod)
  }

  let evalSubParamFrame = (audioParam, params, p, subParamName, def, mod) => {
    evalPerFrameParam(audioParam, params, p, def, (b) => evalSubParamNow(params, p, subParamName, def, b), mod)
  }

  return {
    evalPerEvent: evalMainParamNow,
    evalPerFrame: evalMainParamFrame,
    evalMainParamNow: evalMainParamNow,
    evalSubParamNow: evalSubParamNow,
    evalMainParamFrame: evalMainParamFrame,
    evalSubParamFrame: evalSubParamFrame,
  }
})
