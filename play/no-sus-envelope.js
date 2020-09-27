'use strict';
define(function (require) {
  let system = require('play/system');
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  return (params, gainBase) => {
    let dur = Math.max(0.01, evalPerEvent(params, 'sus', evalPerEvent(params, 'dur', 0.25)))
    let attack = evalPerEvent(params, 'att', 0.09) * params.beat.duration
    params.time -= Math.min(attack, 0.05)
    let decay = evalPerEvent(params, 'decay', 0.08*dur) * params.beat.duration
    let susLevel = evalPerEvent(params, 'suslevel', 0.8)
    let release = evalPerEvent(params, 'rel', params.sus||dur) * params.beat.duration
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(system.audio.currentTime)
    vca.gain.setValueAtTime(0, system.audio.currentTime)
    vca.gain.linearRampToValueAtTime(gain, params.time + attack)
    vca.gain.linearRampToValueAtTime(gain*susLevel, params.time + attack+decay)
    vca.gain.linearRampToValueAtTime(0, params.time + attack+decay+release)
    params.endTime = params.time + attack+decay+release
    return vca
  }
})
