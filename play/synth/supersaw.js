'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let pitchEffects = require('play/effects/pitch-effects')
  let waveEffects = require('play/effects/wave-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  return (params) => {
    let freq = scale.paramsToFreq(params, 4)
    if (isNaN(freq)) { return }
    let detune = evalPerEvent(params, 'detune', 0.1)

    let vca = envelope(params, 0.09, 'full')
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
    system.disconnect(params, vcos.concat(vca,multiosc))
  }
});
