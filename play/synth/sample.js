'use strict';
define(function (require) {
  let system = require('play/system');
  let {getBuffer} = require('play/samples')
  let effects = require('play/effects/effects')
  let {fxMixChain} = require('play/effects/fxMixChain')
  let {evalMainParamEvent,evalSubParamEvent} = require('play/eval-audio-params')
  let scale = require('music/scale');
  let waveEffects = require('play/effects/wave-effects')
  let envelope = require('play/envelopes')
  let pitchEffects = require('play/effects/pitch-effects')
  let perFrameAmp = require('play/effects/perFrameAmp')
  let {tagSource} = require('play/nodes/channels')

  return (params) => {
    let rate = evalMainParamEvent(params, 'rate')
    let source
    if (rate === undefined) {
      let freq = scale.paramsToFreq(params, 4)
      if (isNaN(freq)) { return }
      source = system.audio.createBufferSource()
      source.buffer = getBuffer(evalMainParamEvent(params, 'sample', 'sample/salamander/C4v8.mp3'))
      let samplePitch = evalSubParamEvent(params, 'sample', 'pitch', 261.6256, 'hz')
      source.playbackRate.value = freq / samplePitch
    } else { // If rate is set, use it instead of value/add
      source = system.audio.createBufferSource()
      source.buffer = getBuffer(evalMainParamEvent(params, 'sample', 'sample/salamander/C4v8.mp3'))
      source.playbackRate.value = rate
    }

    tagSource(source, params) // A stereo sample pins every per-note filter it feeds; see play/nodes/channels.js
    params.endTime = params._time + evalMainParamEvent(params, 'dur', 0.1)*params.beat.duration
    let startTime = evalMainParamEvent(params, 'start', 0, 's')

    let vca = envelope(params, 0.25, 'organ')
    waveEffects(params, effects(params, source)).connect(vca)
    fxMixChain(params, perFrameAmp(params, vca))

    pitchEffects(source.detune, params)

    source.start(params._time, startTime)
    params._destructor.disconnect(vca, source)
    params._destructor.stop(source)
  }
});
