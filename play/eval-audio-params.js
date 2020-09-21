'use strict';
define(function (require) {
  let system = require('play/system')
  let param = require('player/default-param')
  let evalParam = require('player/eval-param').evalParamFrame

  let evalPerFrameParam = (audioParam, params, p, def) =>{
    if (params[p] === undefined) {
      audioParam.value = def
    } else if (typeof params[p] == 'number') {
      // single value; no need for callback
      audioParam.value = params[p]
    } else {
      audioParam.value = evalParam(params[p], params.idx, params.count)
      system.add(params.time, state => {
        if (state.time > params.endTime) { return false }
        let v = evalParam(params[p], params.idx, state.count)
        try {
          audioParam.value = v
        } catch (e) { throw `Failed setting audio param ${p} to ${v}` }
        return true
      })
    }
  }

  let evalPerEventParam = (params, p, def) => {
    return evalParam(param(params[p], def), params.idx, params.count)
  }

  return {
    evalPerEvent: evalPerEventParam,
    evalPerFrame: evalPerFrameParam,
  }
})
