'use strict';
define(function (require) {
  let system = require('play/system');
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  let fade = (from, to) => {
    return (new Float32Array(16)).map((_,i) => {
      let lerp = Math.sin(i/15 * 0.5*Math.PI)
      return from*(1-lerp) + to*lerp
    })
  }

  return (params, gainBase) => {
    let dur = Math.max(0.01, evalPerEvent(params, 'sus', evalPerEvent(params, 'dur', 0.25)))
    let attack = evalPerEvent(params, 'att', dur/2) * params.beat.duration
    let release = evalPerEvent(params, 'rel', dur/2) * params.beat.duration
    let sus = Math.max(dur*params.beat.duration - attack, 0)
    let gain = Math.max(0.0001, gainBase * evalPerEvent(params, 'amp', 1))
    let vca = system.audio.createGain()
    vca.gain.cancelScheduledValues(system.audio.currentTime)
    vca.gain.setValueAtTime(0, system.audio.currentTime)
    vca.gain.setValueCurveAtTime(fade(0, gain), params.time, attack)
    vca.gain.linearRampToValueAtTime(gain, params.time + attack+sus)
    vca.gain.setValueCurveAtTime(fade(gain, 0), params.time + attack+sus, release)
    params.endTime = params.time + attack+sus+release
    return vca
  }
})
