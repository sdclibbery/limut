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

  let glideTarget = (params, count, glide) => {
    if (!params._glideBaseEvent) { return 0 }
    let lerp = (count - params.count) / glide
    if (lerp > 1 || lerp < 0) { return 0 }
    let baseFreq = params._glideBaseEvent.freq
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
    // Glide init
    let glide = evalMainParamEvent(params, 'glide', 0)
    if (glide) {
      let es = params._player.events // Find base event to glide from:
        .filter(e => e.voice === params.voice) // Find only events in the same voice
        .sort((a,b) => a.endTime - b.endTime) // If there are multiple possible base events, choose the one that ends latest
      let glideBaseEvent = es[es.length - 1]
      if (glideBaseEvent) {
        // If the base event is still playing, it'll need to glide to this one, so set that up
        glideBaseEvent._glideTargetEvent = params
        glideBaseEvent._glide = glide
        if (glideBaseEvent._setupGlideBase) { glideBaseEvent._setupGlideBase() } // If the base event has no per frame update, then set one up
      }
      params._glideBaseEvent = glideBaseEvent
    }
    // Per event
    let detune = 0
    detune += evalMainParamEvent(params, 'addc', 0)
    setAudioParamValue(audioParam, detune*100, 'pitcheffects')
    // Per frame
    if (hasPerFrameParam(params, 'addc') || hasParam(params, 'vib') || params._glideBaseEvent) {
      let vib = evalMainParamEvent(params, 'vib', 0)
      let vibdepth = evalSubParamEvent(params, 'vib', 'depth', 0.4)
      let vibdelay = evalSubParamEvent(params, 'vib', 'delay', 1/2)
      evalFuncFrame(audioParam, params, 'pitcheffects', (count) => {
        let detune = 0
        detune += evalMainPerFrame(params, 'addc', 0, count)
        detune += vibrato(vib, vibdepth, vibdelay, params.count, count)
        detune += glideTarget(params, count, glide)
        detune += glideBase(params, count)
        return detune*100 // Convert to cents for the detune audioParam
      })
    } else if (params.glide !== undefined) {
      // No per frame update needed, but allow setting one up if this event becomes a glide base event
      params._setupGlideBase = () => {
        evalFuncFrame(audioParam, params, 'pitcheffects', (count) => {
          return glideBase(params, count)*100
        })
      }
    }
  }

})