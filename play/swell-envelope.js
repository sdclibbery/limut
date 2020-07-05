'use strict';
define(function (require) {
  let system = require('play/system');
  let param = require('player/default-param')

  return (params, gainBase) => {
    let dur = Math.max(0.01, param(params.sus, param(params.dur, 0.25)))
    let attack = param(params.attack, dur/2) * params.beat.duration
    let release = param(params.release, dur/2) * params.beat.duration
    let gain = Math.max(0.0001, gainBase * param(params.amp, 1))
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(params.time)
    vca.gain.setValueAtTime(0, params.time)
    vca.gain.linearRampToValueAtTime(gain, params.time + attack)
    vca.gain.linearRampToValueAtTime(0, params.time + attack+release)
    params.endTime = params.time + attack+release
    return vca
  }
})
