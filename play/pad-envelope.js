'use strict';
define(function (require) {
  let system = require('play/system');
  let param = require('player/default-param')

  let fade = (from, to) => {
    return (new Float32Array(16)).map((_,i) => {
      let lerp = Math.sin(i/15 * 0.5*Math.PI)
      return from*(1-lerp) + to*lerp
    })
  }

  return (params, gainBase) => {
    let dur = Math.max(0.01, param(params.sus, param(params.dur, 0.25)))
    let attack = param(params.att, dur/2) * params.beat.duration
    let release = param(params.rel, dur/2) * params.beat.duration
    let sus = Math.max(dur*params.beat.duration - attack, 0)
    let gain = Math.max(0.0001, gainBase * param(params.amp, 1))
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
