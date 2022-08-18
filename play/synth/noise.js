'use strict';
define(function (require) {
  let system = require('play/system')
  let noise = require('play/synth/waveforms/noise')
  let envelope = require('play/envelopes')
  let waveEffects = require('play/effects/wave-effects')
  let effects = require('play/effects/effects')
  let scale = require('music/scale');

  return (params) => {
    let vca = envelope(params, 0.1, 'pad')
    let out = effects(params, vca)
    system.mix(out)

    let source = noise.white()
    waveEffects(params, source).connect(vca)
    let freq = scale.paramsToFreq(params, 4)
    source.playbackRate.value = freq / 261.6256

    let startTime = Math.random()*2
    source.start(params._time, startTime)
    source.stop(params.endTime)
    system.disconnect(params, [source, vca])
  }
});
