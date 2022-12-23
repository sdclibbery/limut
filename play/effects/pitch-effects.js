'use strict';
define(function (require) {
  let {evalFuncFrame,evalMainPerFrame,evalMainParamEvent,evalSubParamEvent,setAudioParamValue} = require('play/eval-audio-params')

  let hasParam = (params, p) => {
    return !!params[p]
  }

  let hasPerFrameParam = (params, p) => {
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

  let glideTarget = (params, count, glide, glideBaseEvent) => {
    if (!glideBaseEvent) { return 0 }
    let lerp = (count - params.count) / glide
    if (lerp > 1 || lerp < 0) { return 0 }
    let baseFreq = glideBaseEvent.freq
    let targetFreq = params.freq
    let glideFreq = targetFreq*lerp + baseFreq*(1-lerp)
    return 12 * Math.log2(glideFreq / targetFreq)
  }

  let glideBase = (params, count) => {
    if (!params._glideTargetEvent) { return 0 }
    let lerp = (count - params._glideTargetEvent.count) / params._glide
    if (lerp < 0) { return 0 }
    if (lerp > 1) { lerp = 1 }
    let baseFreq = params.freq
    let targetFreq = params._glideTargetEvent.freq
    let glideFreq = targetFreq*lerp + baseFreq*(1-lerp)
    return 12 * Math.log2(glideFreq / baseFreq)
  }

  return (audioParam, params) => {
    let glide = evalMainParamEvent(params, 'glide', 0)
    let glideBaseEvent
    if (glide) {
      let es = params._player.events
        .filter(e => e.voice === params.voice) // Find only events in the same voice
        .sort((a,b) => a.endTime - b.endTime) // If there are multiple possible base events, choose the one that goes on longest
      glideBaseEvent = es[es.length - 1]
      if (glideBaseEvent) {
        glideBaseEvent._glideTargetEvent = params
        glideBaseEvent._glide = glide
      }
    }
    // per event
    let detune = 0
    detune += evalMainParamEvent(params, 'addc', 0)
    setAudioParamValue(audioParam, detune*100, 'pitcheffects')
    // per frane
    if (hasPerFrameParam(params, 'addc') || hasParam(params, 'vib') || glideBaseEvent) {
      let vib = evalMainParamEvent(params, 'vib', 0)
      let vibdepth = evalSubParamEvent(params, 'vib', 'depth', 0.4)
      let vibdelay = evalSubParamEvent(params, 'vib', 'delay', 1/2)
      evalFuncFrame(audioParam, params, 'pitcheffects', (count) => {
        let detune = 0
        detune += evalMainPerFrame(params, 'addc', 0, count)
        detune += vibrato(vib, vibdepth, vibdelay, params.count, count)
        detune += glideTarget(params, count, glide, glideBaseEvent)
        detune += glideBase(params, count)
        return detune*100 // Convert to cents for the detune audioParam
      })
    }
  }

})