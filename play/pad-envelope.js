'use strict';
define(function (require) {
  let system = require('play/system');
  let param = require('player/default-param')

  return (params, gainBase) => {
    let dur = Math.max(0.01, param(params.sus, param(params.dur, 0.25)))
    let attack = param(params.att, dur/2) * params.beat.duration
    let release = param(params.rel, dur/2) * params.beat.duration
    let sus = dur*params.beat.duration - attack
    let gain = Math.max(0.0001, gainBase * param(params.amp, 1))
    let vca = system.audio.createGain()
    vca.gain.cancelScheduledValues(params.time)
    vca.gain.setValueAtTime(0, params.time)
    vca.gain.linearRampToValueAtTime(gain, params.time + attack)
    vca.gain.linearRampToValueAtTime(gain, params.time + attack+sus)
    vca.gain.linearRampToValueAtTime(0, params.time + attack+sus+release)
    params.endTime = params.time + attack+sus+release
    return vca
  }
})
