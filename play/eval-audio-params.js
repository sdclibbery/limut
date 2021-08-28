'use strict';
define(function (require) {
  let system = require('play/system')
  let evalParam = require('player/eval-param').evalParamFrame

  let setAudioParamValue = (audioParam, v) => {
    try {
      if (v !== undefined) { audioParam.value = v }
    } catch (e) { throw `Failed setting audio param ${p} to ${v}` }
  }

  let evalPerFrameParam = (audioParam, params, p, def) =>{
    if (params[p] === undefined) {
      audioParam.value = def
    } else if (typeof params[p] == 'number') {
      // single value; no need for callback
      audioParam.value = params[p]
    } else {
      setAudioParamValue(audioParam, evalParam(params[p], params, params.count))
      system.add(params._time, state => {
        if (state.time > params.endTime) { return false }
        setAudioParamValue(audioParam, evalParam(params[p], params, state.count))
        return true
      })
    }
  }

  let evalPerEventParam = (params, p, def) => {
    let v = params[p]
    if (typeof v !== 'number' && !v) { return def }
    v =  evalParam(v, params, params.count)
    if (typeof v !== 'number' && !v) { return def }
    return v
  }

  return {
    evalPerEvent: evalPerEventParam,
    evalPerFrame: evalPerFrameParam,
  }
})
