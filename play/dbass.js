define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/envelope')
  let effects = require('play/effects')
  let evalParam = require('player/eval-param')

  return (params) => {
    let degree = parseInt(params.sound)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalParam(params.oct, 2))
    let detuneSemis = evalParam(params.detune, 0.25)

    let vca = envelope(params, 0.02)
    system.mix(effects(params, vca))

    let vcos = [0, 0.7, 1].map(lerp => {
      vco = system.audio.createOscillator()
      vco.type = 'sawtooth';
      vco.frequency.value = freq
      vco.detune.value = lerp * detuneSemis*100
      return vco
    })
    vcos.forEach(vco => vco.connect(vca))
    vcos.forEach(vco => vco.start(params.time))
    vcos.forEach(vco => vco.stop(params.endTime))
  }
});
