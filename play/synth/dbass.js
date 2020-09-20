'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/full-envelope')
  let effects = require('play/effects')
  let pitchEffects = require('play/pitch-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  return (params) => {
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 2), params.scale)
    let detuneSemis = evalPerEvent(params, 'detune', 0.25)

    let vca = envelope(params, 0.03)
    let out = effects(params, vca)
    system.mix(out)

    let pitch = pitchEffects(params)
    let vcos = [0, 0.7, 1].map(lerp => {
      let vco = system.audio.createOscillator()
      vco.type = 'sawtooth';
      vco.frequency.value = freq * Math.pow(2, lerp * detuneSemis/12)
      pitch.connect(vco.detune)
      return vco
    })
    vcos.forEach(vco => vco.connect(vca))
    vcos.forEach(vco => vco.start(params.time))
    vcos.forEach(vco => vco.stop(params.endTime))
    system.disconnect(params, vcos.concat(vca,out))
  }
});
