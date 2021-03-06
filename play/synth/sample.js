'use strict';
define(function (require) {
  let system = require('play/system');
  let {getBuffer} = require('play/samples')
  let effects = require('play/effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')
  let scale = require('music/scale');
  let waveEffects = require('play/wave-effects')
  let envelope = require('play/envelopes')

  return (params) => {
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 4), evalPerEvent(params, 'scale'), evalPerEvent(params, 'sharp', 0))
    let source = system.audio.createBufferSource()
    source.buffer = getBuffer(evalPerEvent(params, 'sample', 'sample/salamander/C4v8.mp3'))
    let samplePitch = evalPerEvent(params, 'samplepitch', 261.6256)
    source.playbackRate.value = freq / samplePitch
    params.endTime = params._time + evalPerEvent(params, 'dur', 0.1)*params.beat.duration

    let vca = envelope(params, 0.25, 'full')
    waveEffects(params, source).connect(vca)
    system.mix(effects(params, vca))

    source.start(params._time)
    source.stop(params.endTime)
    system.disconnect(params, [source, vca])
  }
});
