'use strict';
define(function (require) {
  if (!window.AudioWorkletNode) { return () => {} }

  let createSuperOsc = require('play/superosc-source')
  let scale = require('music/scale')
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let {fxMixChain} = require('play/effects/fxMixChain')
  let pitchEffects = require('play/effects/pitch-effects')
  let waveEffects = require('play/effects/wave-effects')
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let perFrameAmp = require('play/effects/perFrameAmp')

  return (params) => {
    let freq = scale.paramsToFreq(params, 4)
    if (isNaN(freq)) { return }
    let detuneSemis = evalMainParamEvent(params, 'detune', 0)

    let vca = envelope(params, 0.06, 'full')
    fxMixChain(params, perFrameAmp(params, vca))

    let vco = createSuperOsc()
    vco.parameters.get('frequency').value = freq * Math.pow(2, detuneSemis/12)
    pitchEffects(vco.parameters.get('detune'), params)

    waveEffects(params, effects(params, vco)).connect(vca)
    vco.start(params._time)
    vco.stop(params.endTime)
    params._destructor.disconnect(vca, vco)
  }
});
