'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let fxMixChain = require('play/effects/fxMixChain')
  let pitchEffects = require('play/effects/pitch-effects')
  let waveEffects = require('play/effects/wave-effects')
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let setWave = require('play/synth/waveforms/set-wave')

  return (params) => {
    let freq = scale.paramsToFreq(params, 4)
    if (isNaN(freq)) { return }
    let detuneSemis = evalMainParamEvent(params, 'detune', 0)
    let wave = evalMainParamEvent(params, "wave", "sawtooth")

    let vca = envelope(params, 0.06, 'full')
    fxMixChain(params, effects(params, vca))

    let vco = system.audio.createOscillator()
    setWave(vco, wave)
    vco.frequency.value = freq * Math.pow(2, detuneSemis/12)
    pitchEffects(vco.detune, params)
    
    waveEffects(params, vco).connect(vca)
    vco.start(params._time)
    vco.stop(params.endTime)
    system.disconnect(params, [vca,vco])
  }
});
