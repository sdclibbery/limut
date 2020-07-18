'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/pad-envelope')
  let effects = require('play/effects')
  let param = require('player/default-param')
  let fm = require('play/fm')

  return (params) => {
    let degree = parseInt(params.sound) + param(params.add, 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, param(params.oct, 4))
    let detuneSemis = param(params.detune, 0.1)

    let vca = envelope(params, 0.01)
    system.mix(effects(params, vca))

    let vcos = [0, 0.7, 1].map(lerp => {
      let vco = system.audio.createOscillator()
      vco.type = 'sine';
      vco.frequency.value = freq
      vco.detune.value = lerp * detuneSemis*100
      return vco
    })
    vcos.forEach(vco => vco.connect(vca))
    vcos.forEach(vco => vco.start(params.time))
    vcos.forEach(vco => vco.stop(params.endTime))
  }
});
