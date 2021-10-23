'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let pitchEffects = require('play/effects/pitch-effects')
  let waveEffects = require('play/effects/wave-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')
  let pulse = require('play/synth/waveforms/pulse')
  let setWave = require('play/synth/waveforms/set-wave')

  return (params) => {
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 4), evalPerEvent(params, 'scale'), evalPerEvent(params, 'sharp', 0))
    let detuneSemis = evalPerEvent(params, 'detune', 0.1)
    let wave = evalPerEvent(params, "wave", "sawtooth")

    let vca = envelope(params, 0.06, 'full')
    let out = effects(params, vca)
    system.mix(out)

    let pitch = pitchEffects(params)
    let vcos = [0, 0.7, 1].map(lerp => {
      let vco = system.audio.createOscillator()
      setWave(vco, wave)
      vco.frequency.value = freq * Math.pow(2, lerp * detuneSemis/12)
      pitch.connect(vco.detune)
      return vco
    })
    
    let multiosc = system.audio.createGain()
    multiosc.gain.value = 1/vcos.length
    waveEffects(params, multiosc).connect(vca)
    vcos.forEach(vco => vco.connect(multiosc))
    vcos.forEach(vco => vco.start(params._time))
    vcos.forEach(vco => vco.stop(params.endTime))
    system.disconnect(params, vcos.concat(vca,multiosc))
  }
});
