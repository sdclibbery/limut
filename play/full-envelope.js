'use strict';
define(function (require) {
  let system = require('play/system');
  let param = require('player/default-param')

  return (params, gainBase) => {
    let dur = Math.max(0.01, param(params.sus, param(params.dur, 0.25)))
    let attack = param(params.att, 0.09) * params.beat.duration
    params.time -= Math.min(attack, 0.05)
    let decay = param(params.decay, 0.08*dur) * params.beat.duration
    let sustain = param(params.sus, dur) * params.beat.duration - decay
    let susLevel = param(params.suslevel, 0.8)
    let release = param(params.rel, 0.1*dur) * params.beat.duration
    let gain = Math.max(0.0001, gainBase * param(params.amp, 1))
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(params.time)
    vca.gain.setValueAtTime(0, params.time)
    vca.gain.linearRampToValueAtTime(gain, params.time + attack)
    vca.gain.linearRampToValueAtTime(gain*susLevel, params.time + attack+decay)
    vca.gain.linearRampToValueAtTime(gain*susLevel*0.8, params.time + attack+decay+sustain)
    vca.gain.linearRampToValueAtTime(0, params.time + attack+decay+sustain+release)
    params.endTime = params.time + attack+decay+sustain+release
    return vca
  }
})
