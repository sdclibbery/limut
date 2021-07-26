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
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 4), evalPerEvent(params, 'scale'), evalPerEvent(params, 'sharp', 0))
    let detune = evalPerEvent(params, 'detune', 0.1)

    let vca = envelope(params, 0.07, 'full')
    let out = effects(params, vca)
    system.mix(out)

    let pitch = pitchEffects(params)
    let vcos = [1.1077, 1.0633, 1.0204, 1, 0.9811, 0.9382, 0.8908].map(vcoDetune => {
      let vco = system.audio.createOscillator()
      vco.type = 'sawtooth'
      vco.frequency.value = freq * (detune*vcoDetune + 1-detune)
      pitch.connect(vco.detune)
      return vco
    })
    
    let multiosc = system.audio.createGain()
    multiosc.gain.value = 1/vcos.length
    waveEffects(params, multiosc).connect(vca)
    vcos.forEach(vco => vco.connect(multiosc))
    vcos.forEach(vco => vco.start(params._time))
    vcos.forEach(vco => vco.stop(params.endTime))
    system.disconnect(params, vcos.concat(vca,out,multiosc))
  }
});
