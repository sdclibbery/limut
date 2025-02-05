'use strict';
define(function (require) {
  let {evalParamEvent} = require('player/eval-param')
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let {fxMixChain} = require('play/effects/fxMixChain')
  let waveEffects = require('play/effects/wave-effects')
  let perFrameAmp = require('play/effects/perFrameAmp')

  return (params) => {
    let vca = envelope(params, 0.06, 'none')
    let playChain = evalParamEvent(params.play, params) // Get the Audionode chain for this event
    if (playChain === undefined) {
      fxMixChain(params, vca) // No play chain, eg monosynth with oscillator in the fx chain
    } else {
      fxMixChain(params, perFrameAmp(params, vca))
      waveEffects(params, effects(params, playChain)).connect(vca)
    }
    params._destructor.disconnect(vca)
  }
});
