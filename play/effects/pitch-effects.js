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

  let glideSemis = (params, count, glide, glideBaseEvent) => {
    if (!glideBaseEvent) { return 0 }
    let lerp = (count - params.count) / glide
    if (lerp > 1) { return 0 }
    let baseFreq = glideBaseEvent.freq
    let targetFreq = params.freq
    let glideFreq = targetFreq*lerp + baseFreq*(1-lerp)
    return 12 * Math.log2(glideFreq / targetFreq)
  }

  return (audioParam, params) => {
    let glide = evalMainParamEvent(params, 'glide', 0)
    let glideBaseEvent
    if (glide) {
      let es = params._player.events.filter(e => e.voice === params.voice)
      glideBaseEvent = es[es.length-1]
    }
    // per event
    let detune = 0
    detune += evalMainParamEvent(params, 'addc', 0)
    setAudioParamValue(audioParam, detune*100, 'pitcheffects')
    // per frane
    if (hasFrameParam(params, 'addc') || hasParam(params, 'vib') || glideBaseEvent) {
      let vib = evalMainParamEvent(params, 'vib', 0)
      let vibdepth = evalSubParamEvent(params, 'vib', 'depth', 0.4)
      let vibdelay = evalSubParamEvent(params, 'vib', 'delay', 1/2)
      evalFuncFrame(audioParam, params, 'pitcheffects', (count) => {
        let detune = 0
        detune += evalMainPerFrame(params, 'addc', 0, count)
        detune += vibrato(vib, vibdepth, vibdelay, params.count, count)
        detune += glideSemis(params, count, glide, glideBaseEvent)
        return detune*100 // Convert to cents for the detune audioParam
      })
      }
  }

})