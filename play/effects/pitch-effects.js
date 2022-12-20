'use strict';
define(function (require) {
  let {evalFuncFrame,evalMainPerFrame,evalMainParamEvent,evalSubParamEvent} = require('play/eval-audio-params')

  let hasParam = (params, p) => {
    return !!params[p]
  }

  let vibrato = (vib, vibdepth, vibdelay, start, count) => {
    if (!vib) { return 0 }
    let t = count - start
    let v = Math.sin(2*Math.PI*t*vib)
    if (t < vibdelay) {
      let lerp = 1 - (vibdelay-t)/vibdelay
      v *= Math.pow(lerp, 8)
    }
    return v * vibdepth
  }

  return (params) => {
    return {
      connect : (audioParam) => {
        if (!hasParam(params, 'addc') && !hasParam(params, 'vib')) {
          return // Don't update per frame if there's nothing to set
        }
        // Possible optimisation: If there is only addc, and it is a constant, then just set the audioParam, do not do per-frame update
        let vib = evalMainParamEvent(params, 'vib', 0)
        let vibdepth = evalSubParamEvent(params, 'vib', 'depth', 0.4)
        let vibdelay = evalSubParamEvent(params, 'vib', 'delay', 1/2)
        evalFuncFrame(audioParam, params, "pitcheffects", (count) => {
          let pitch = 0
          pitch += evalMainPerFrame(params, 'addc', 0, count)
          pitch += vibrato(vib, vibdepth, vibdelay, params.count, count)
          return pitch*100 // Convert to cents for the detune audioParam
        })
      }
    }
  }

})