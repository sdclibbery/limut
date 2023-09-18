'use strict';
define(function (require) {
  let noise = require('play/synth/waveforms/noise')
  let envelope = require('play/envelopes')
  let waveEffects = require('play/effects/wave-effects')
  let effects = require('play/effects/effects')
  let {fxMixChain} = require('play/effects/fxMixChain')
  let scale = require('music/scale');
  let perFrameAmp = require('play/effects/perFrameAmp')

  return (params) => {
    let vca = envelope(params, 0.1, 'pad')
    fxMixChain(params, perFrameAmp(params, vca))

    let source = noise.white()
    waveEffects(params, effects(params, source)).connect(vca)
    let freq = scale.paramsToFreq(params, 4)
    source.playbackRate.value = freq / 261.6256

    let startTime = Math.random()*2
    source.start(params._time, startTime)
    params._destructor.disconnect(vca, source)
    params._destructor.stop(source)
  }
});
