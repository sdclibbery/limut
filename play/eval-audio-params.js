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
      system.add(params.time, state => {
        if (state.time > params.endTime) { return false }
        audioParam.value = evalParam(params[p], params.idx, state.count)
        return true
      })
    }
  }

  let evalPerEventParam = (params, p, def) =>{
    return evalParam(param(params[p], def), params.idx, params.beat.count)
  }

  return {
    evalPerEvent: evalPerEventParam,
    evalPerFrame: evalPerFrameParam,
  }
})
