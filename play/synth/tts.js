'use strict';
define(function (require) {
  let system = require('play/system');
  let {getTtsBuffer} = require('play/tts')
  let effects = require('play/effects/effects')
  let {fxMixChain} = require('play/effects/fxMixChain')
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let scale = require('music/scale');
  let waveEffects = require('play/effects/wave-effects')
  let envelope = require('play/envelopes')
  let pitchEffects = require('play/effects/pitch-effects')
  let perFrameAmp = require('play/effects/perFrameAmp')

  // Collect the espeak voice options that change the synthesized audio. These form
  // part of the cache key in play/tts.js; pitch shifting by note is applied later
  // via playbackRate (like sample.js) and is intentionally NOT part of the key.
  let voiceOpts = (params) => {
    let opts = {}
    let add = (name) => {
      let v = evalMainParamEvent(params, name, undefined)
      if (v !== undefined) { opts[name] = v }
    }
    add('pitch')      // 0..99, espeak voice pitch (default 50)
    add('speed')      // words per minute (default 175)
    add('wordgap')    // pause between words, units of 10ms
    add('amplitude')  // 0..200 (default 100)
    add('variant')    // voice variant, eg 'f2', 'm3'
    return opts
  }

  return (params) => {
    let text = evalMainParamEvent(params, 'text', '')
    if (!text) { return }

    let buffer = getTtsBuffer(text, voiceOpts(params))
    if (!buffer) { return } // engine/voice still loading, or this phrase not synthesized yet

    // Pitch: explicit rate wins, otherwise transpose the speech by the note (note 0
    // at the default octave plays at rate 1), mirroring play/synth/sample.js.
    let rate = evalMainParamEvent(params, 'rate')
    let playbackRate
    if (rate === undefined) {
      let freq = scale.paramsToFreq(params, 4)
      playbackRate = isNaN(freq) ? 1 : freq / 261.6256
    } else {
      playbackRate = rate
    }

    let source = system.audio.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = playbackRate

    // Let the utterance play its full natural length: default the event duration to
    // the speech length in beats so the (organ) envelope sustains the whole phrase.
    if (params.dur === undefined) {
      params.dur = (buffer.duration / playbackRate) / params.beat.duration
    }

    let vca = envelope(params, 0.3, 'organ')
    waveEffects(params, effects(params, source)).connect(vca)
    fxMixChain(params, perFrameAmp(params, vca))

    pitchEffects(source.detune, params)

    source.start(params._time)
    params._destructor.disconnect(vca, source)
    params._destructor.stop(source)
  }
});
