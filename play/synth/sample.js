'use strict';
define(function (require) {
  let system = require('play/system');
  let {getBuffer} = require('play/samples')
  let effects = require('play/effects/effects')
  let fxMixChain = require('play/effects/fxMixChain')
  let {evalMainParamEvent,evalSubParamEvent} = require('play/eval-audio-params')
  let scale = require('music/scale');
  let waveEffects = require('play/effects/wave-effects')
  let envelope = require('play/envelopes')
  let pitchEffects = require('play/effects/pitch-effects')

  return (params) => {
    let freq = scale.paramsToFreq(params, 4)
    if (isNaN(freq)) { return }
    let source = system.audio.createBufferSource()
    source.buffer = getBuffer(evalMainParamEvent(params, 'sample', 'sample/salamander/C4v8.mp3'))
    let samplePitch = evalSubParamEvent(params, 'sample', 'pitch', 261.6256)
    source.playbackRate.value = freq / samplePitch
    params.endTime = params._time + evalMainParamEvent(params, 'dur', 0.1)*params.beat.duration
    let startTime = evalMainParamEvent(params, 'start', 0)

    let vca = envelope(params, 0.25, 'full')
    waveEffects(params, source).connect(vca)
    fxMixChain(params, effects(params, vca))

    pitchEffects(source.detune, params)

    source.start(params._time, startTime)
    source.stop(params.endTime)
    system.disconnect(params, [source, vca])
  }
});
