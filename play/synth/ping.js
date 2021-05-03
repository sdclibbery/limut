'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects')
  let pitchEffects = require('play/pitch-effects')
  let waveEffects = require('play/wave-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  return (params) => {
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 5), evalPerEvent(params, 'scale'), evalPerEvent(params, 'sharp', 0))

    let vca = envelope(params, 0.04, 'simple')
    system.mix(effects(params, vca))

    let vco = system.audio.createOscillator()
    vco.type = 'sine'
    vco.frequency.value = freq
    pitchEffects(params).connect(vco.detune)
    waveEffects(params, vco).connect(vca)
    vco.start(params.time)
    vco.stop(params.endTime)
    system.disconnect(params, [vco, vca])
  }
})
