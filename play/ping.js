define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/no-sus-envelope')
  let effects = require('play/effects')
  let param = require('player/default-param')

  return (params) => {
    let degree = parseInt(params.sound) + param(params.add, 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, param(params.oct, 5))
    let detuneSemis = param(params.detune, 0.25)

    let vca = envelope(params, 0.02)
    system.mix(effects(params, vca))

    let vco = system.audio.createOscillator()
    vco.type = 'sine';
    vco.frequency.value = freq
    vco.detune.value = detuneSemis*100
    vco.connect(vca)
    vco.start(params.time)
    vco.stop(params.endTime)
  }


  // return (params) => {
  //   let degree = parseInt(params.sound) + param(params.add, 0)
  //   if (isNaN(degree)) { return }
  //   let freq = scale.degreeToFreq(degree, param(params.oct, 5))
  //
  //   params.suslevel = param(params.suslevel, 0.6)
  //   let vca = envelope(params, 0.1)
  //   system.mix(effects(params, vca))
  //
  //   let vco = system.audio.createOscillator()
  //   vco.type = 'triangle'
  //   vco.frequency.value = freq
  //   vco => vco.connect(vca)
  //   vco => vco.start(params.time)
  //   vco => vco.stop(params.endTime)
  // }
});
