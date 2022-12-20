'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let pitchEffects = require('play/effects/pitch-effects')
  let waveEffects = require('play/effects/wave-effects')
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let setWave = require('play/synth/waveforms/set-wave')

  return (params) => {
    let freq = scale.paramsToFreq(params, 4)
    if (isNaN(freq)) { return }
    let detune = evalMainParamEvent(params, 'detune', 0.1)
    let wave = evalMainParamEvent(params, "wave", "sawtooth")

    let vca = envelope(params, 0.09, 'full')
    let out = effects(params, vca)
    system.mix(out)

    let vcos = [1.1077, 1.0633, 1.0204, 1, 0.9811, 0.9382, 0.8908].map(vcoDetune => {
      let vco = system.audio.createOscillator()
      setWave(vco, wave)
      vco.frequency.value = freq * (detune*vcoDetune + 1-detune)
      pitchEffects(vco.detune, params)
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
