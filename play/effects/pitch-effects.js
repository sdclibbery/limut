'use strict';
define(function (require) {
  let {evalFuncFrame,evalMainPerFrame,evalMainParamEvent,evalSubParamEvent,setAudioParamValue} = require('play/eval-audio-params')

  let hasParam = (params, p) => {
    return !!params[p]
  }

  let hasFrameParam = (params, p) => {
    let v = params[p]
    if (typeof v === 'function') { return true }
    return false
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

  return (audioParam, params) => {
    // per event
    let detune = 0
    detune += evalMainParamEvent(params, 'addc', 0)
    setAudioParamValue(audioParam, detune*100, 'pitcheffects')
    // per frane
    if (hasFrameParam(params, 'addc') || hasParam(params, 'vib')) {
      let vib = evalMainParamEvent(params, 'vib', 0)
      let vibdepth = evalSubParamEvent(params, 'vib', 'depth', 0.4)
      let vibdelay = evalSubParamEvent(params, 'vib', 'delay', 1/2)
      evalFuncFrame(audioParam, params, 'pitcheffects', (count) => {
        let detune = 0
        detune += evalMainPerFrame(params, 'addc', 0, count)
        detune += vibrato(vib, vibdepth, vibdelay, params.count, count)
        return detune*100 // Convert to cents for the detune audioParam
      })
      }
  }

})