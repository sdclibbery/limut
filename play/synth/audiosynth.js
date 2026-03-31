'use strict';
define(function (require) {
  let {evalParamEvent} = require('player/eval-param')
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let {fxMixChain} = require('play/effects/fxMixChain')
  let waveEffects = require('play/effects/wave-effects')
  let perFrameAmp = require('play/effects/perFrameAmp')
  let system = require('play/system')

  return (params) => {
    let vca = envelope(params, 0.06, 'none')
    let playChain = evalParamEvent(params.play, params) // Get the Audionode chain for this event
    if (playChain !== undefined && !(playChain instanceof AudioNode)) { // {osc1,osc2} map syntax yields a plain object with AudioNode values — merge into one node
      let merger = system.audio.createGain()
      let hasNodes = false
      for (let k in playChain) {
        let v = playChain[k]
        if (v instanceof AudioNode) { v.connect(merger); hasNodes = true }
      }
      playChain = hasNodes ? merger : undefined
      params._destructor.disconnect(merger)
    }
    if (playChain === undefined) {
      fxMixChain(params, vca) // No play chain, eg monosynth with oscillator in the fx chain
    } else {
      fxMixChain(params, perFrameAmp(params, vca))
      waveEffects(params, effects(params, playChain)).connect(vca)
    }
    params._destructor.disconnect(vca)
  }
});
