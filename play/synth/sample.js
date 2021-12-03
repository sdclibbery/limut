'use strict';
define(function (require) {
  let system = require('play/system');
  let {getBuffer} = require('play/samples')
  let effects = require('play/effects/effects')
  let {evalMainParamNow} = require('play/eval-audio-params')
  let scale = require('music/scale');
  let waveEffects = require('play/effects/wave-effects')
  let envelope = require('play/envelopes')

  return (params) => {
    let freq = scale.paramsToFreq(params, 4)
    if (isNaN(freq)) { return }
    let source = system.audio.createBufferSource()
    source.buffer = getBuffer(evalMainParamNow(params, 'sample', 'sample/salamander/C4v8.mp3'))
    let samplePitch = evalMainParamNow(params, 'samplepitch', 261.6256)
    source.playbackRate.value = freq / samplePitch
    params.endTime = params._time + evalMainParamNow(params, 'dur', 0.1)*params.beat.duration

    let vca = envelope(params, 0.25, 'full')
    waveEffects(params, source).connect(vca)
    system.mix(effects(params, vca))

    source.start(params._time)
    source.stop(params.endTime)
    system.disconnect(params, [source, vca])
  }
});
