'use strict';
define(function (require) {
  let system = require('play/system');
  let param = require('player/default-param')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  let fullEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalPerEvent(params, 'sus', evalPerEvent(params, 'dur', 0.25)))
    dur *= evalPerEvent(params, "long", 1)
    let attack = evalPerEvent(params, 'att', 0.09) * params.beat.duration
    params._time -= Math.min(attack, 0.05)
    let decay = evalPerEvent(params, 'decay', 0.08*dur) * params.beat.duration
    let sustain = evalPerEvent(params, 'sus', dur) * params.beat.duration - decay
    let susLevel = evalPerEvent(params, 'suslevel', 0.8)
    let release = evalPerEvent(params, 'rel', 0.1*dur) * params.beat.duration
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
    let dur = Math.max(0.01, evalPerEvent(params, 'sus', evalPerEvent(params, 'dur', 0.25)))
    dur *= evalPerEvent(params, "long", 1)
    let attack = evalPerEvent(params, 'att', 0.09) * params.beat.duration
    params._time -= Math.min(attack, 0.05)
    let decay = evalPerEvent(params, 'decay', 0.08*dur) * params.beat.duration
    let susLevel = evalPerEvent(params, 'suslevel', 0.8)
    let release = evalPerEvent(params, 'rel', dur) * params.beat.duration
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
    let dur = Math.max(evalPerEvent(params, 'sus', evalPerEvent(params, 'dur', 0.25)), 0.01)
    dur *= evalPerEvent(params, "long", 1)
    let attack = Math.max(evalPerEvent(params, 'att', dur/2) * params.beat.duration, 0.001)
    let release = Math.max(evalPerEvent(params, 'rel', dur/2) * params.beat.duration, 0.001)
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
    gainbase *= evalPerEvent(params, "loud", 1)
    let envelope = evalPerEvent(params, "envelope", defaultEnvelope)
    switch (envelope) {
      case 'full': return fullEnvelope(params, gainbase)
      case 'simple': return simpleEnvelope(params, gainbase)
      case 'pad': return padEnvelope(params, gainbase)
    }
    return fullEnvelope(params, gainbase)
  }
})
