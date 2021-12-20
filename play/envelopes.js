'use strict';
define(function (require) {
  let system = require('play/system');
  let {evalMainParamEvent,evalSubParamEvent} = require('play/eval-audio-params')

  let fullEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25)))
    dur *= evalMainParamEvent(params, "long", 1)
    let attack = evalMainParamEvent(params, 'att', 0.09) * params.beat.duration
    params._time -= Math.min(attack, 0.05)
    let decay = evalMainParamEvent(params, 'dec', 0.08*dur) * params.beat.duration
    let sustain = evalMainParamEvent(params, 'sus', dur) * params.beat.duration - decay
    let susLevel = evalSubParamEvent(params, 'sus', 'level', 0.8)
    let release = evalMainParamEvent(params, 'rel', 0.1*dur) * params.beat.duration
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(0)
    vca.gain.setValueAtTime(0, 0)
    vca.gain.setValueAtTime(0, params._time)
    vca.gain.linearRampToValueAtTime(gain, params._time + attack)
    vca.gain.linearRampToValueAtTime(gain*susLevel, params._time + attack+decay)
    vca.gain.linearRampToValueAtTime(gain*susLevel*0.8, params._time + attack+decay+sustain)
    vca.gain.linearRampToValueAtTime(0, params._time + attack+decay+sustain+release)
    params.endTime = params._time + attack+decay+sustain+release
    return vca
  }

  let simpleEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25)))
    dur *= evalMainParamEvent(params, "long", 1)
    let attack = evalMainParamEvent(params, 'att', 0.09) * params.beat.duration
    params._time -= Math.min(attack, 0.05)
    let decay = evalMainParamEvent(params, 'dec', 0.08*dur) * params.beat.duration
    let susLevel = evalSubParamEvent(params, 'sus', 'level', 0.8)
    let release = evalMainParamEvent(params, 'rel', dur) * params.beat.duration
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(0)
    vca.gain.setValueAtTime(0, 0)
    vca.gain.setValueAtTime(0, params._time)
    vca.gain.linearRampToValueAtTime(gain, params._time + attack)
    vca.gain.linearRampToValueAtTime(gain*susLevel, params._time + attack+decay)
    vca.gain.linearRampToValueAtTime(0, params._time + attack+decay+release)
    params.endTime = params._time + attack+decay+release
    return vca
  }

  let fade = (from, to) => {
    return (new Float32Array(16)).map((_,i) => {
      let lerp = Math.sin(i/15 * 0.5*Math.PI)
      return from*(1-lerp) + to*lerp
    })
  }

  let padEnvelope = (params, gainBase) => {
    let dur = Math.max(evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25)), 0.01)
    dur *= evalMainParamEvent(params, "long", 1)
    let attack = Math.max(evalMainParamEvent(params, 'att', dur/2) * params.beat.duration, 0.001)
    let release = Math.max(evalMainParamEvent(params, 'rel', dur/2) * params.beat.duration, 0.001)
    let sus = Math.max(dur*params.beat.duration - attack, 0.001)
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain()
    vca.gain.cancelScheduledValues(0)
    vca.gain.setValueAtTime(0, 0)
    vca.gain.setValueCurveAtTime(fade(0, gain), params._time, attack)
    vca.gain.linearRampToValueAtTime(gain, params._time + attack+sus)
    vca.gain.setValueCurveAtTime(fade(gain, 0), params._time + attack+sus, release)
    params.endTime = params._time + attack+sus+release
    return vca
  }

  return (params, gainbase, defaultEnvelope) => {
    gainbase *= evalMainParamEvent(params, "loud", 1)
    let envelope = evalMainParamEvent(params, "envelope", defaultEnvelope)
    switch (envelope) {
      case 'full': return fullEnvelope(params, gainbase)
      case 'simple': return simpleEnvelope(params, gainbase)
      case 'pad': return padEnvelope(params, gainbase)
    }
    return fullEnvelope(params, gainbase)
  }
})
