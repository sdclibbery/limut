'use strict';
define(function (require) {
  let system = require('play/system');
  let effects = require('play/effects/effects')
  let {fxMixChain} = require('play/effects/fxMixChain')
  let waveEffects = require('play/effects/wave-effects')
  let perFrameAmp = require('play/effects/perFrameAmp')
  let destructor = require('play/destructor')
  let click = require('play/synth/waveforms/click')

  return (params) => {
    let gainBase = 0.1
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    params.endTime = params._time + 0.01
    params._destructor = destructor(true)
    setTimeout(() => params._destructor.destroy(), 100+(params.endTime - system.audio.currentTime)*1000)

    let vca = system.audio.createGain()
    vca.gain.value = gain
    fxMixChain(params, perFrameAmp(params, vca))

    let clickNode = click.click()
    clickNode.start(params._time)

    waveEffects(params, effects(params, clickNode)).connect(vca)
    params._destructor.disconnect(vca, clickNode)
    params._destructor.stop(clickNode)
  }
})
