'use strict';
define(function (require) {
  if (!window.AudioWorkletNode) { return () => {} }

  let createSuperOsc = require('play/superosc-source')
  let scale = require('music/scale')
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let {fxMixChain} = require('play/effects/fxMixChain')
  let pitchEffects = require('play/effects/pitch-effects')
  let waveEffects = require('play/effects/wave-effects')
  let {evalMainParamEvent,evalSubParamEvent,evalMainParamFrame,evalSubParamFrame} = require('play/eval-audio-params')
  let perFrameAmp = require('play/effects/perFrameAmp')
  let {getBuffer} = require('play/samples')

  return (params) => {
    let freq = scale.paramsToFreq(params, 4)
    if (isNaN(freq)) { return }
    let detuneSemis = evalMainParamEvent(params, 'detune', 0)

    let vca = envelope(params, 0.06, 'full')
    fxMixChain(params, perFrameAmp(params, vca))

    // Stereo output only when there are 2+ unison voices AND a non-zero pan
    // spread (evaluated once at note start); otherwise every voice is centred so
    // a mono node is enough and keeps the downstream fx chain mono (cheaper).
    let unison = evalMainParamEvent(params, 'unison', 1)
    let pan = evalSubParamEvent(params, 'unison', 'pan', 0.5)
    let vco = createSuperOsc(Math.round(unison) >= 2 && pan !== 0 ? 2 : 1)
    vco.parameters.get('frequency').value = freq * Math.pow(2, detuneSemis/12)
    pitchEffects(vco.parameters.get('detune'), params)

    // The wavetable is a sample buffer sliced into `count` single-cycle frames
    // (count is a subparam of wavetable, eg wavetable={'...', count:64}). With no
    // wavetable set the oscillator stays silent; when the sample loads (sync or
    // async via the samples cache) it is pushed to the worklet, which switches to
    // it in place. `wt` (0..1) morphs across the frames.
    let wavetableUrl = evalMainParamEvent(params, 'wavetable', undefined)
    if (wavetableUrl) {
      let count = evalSubParamEvent(params, 'wavetable', 'count', 64)
      let buf = getBuffer(wavetableUrl, (b) => vco.setWave(b.getChannelData(0), count))
      if (buf) { vco.setWave(buf.getChannelData(0), count) }
    }
    evalMainParamFrame(vco.parameters.get('wt'), params, 'wt', 0)

    // sync: oscillator hard-sync ratio (0 = off). Remaps the phase to restart
    // `sync` times per fundamental cycle for the classic hard-sync timbre.
    evalMainParamFrame(vco.parameters.get('sync'), params, 'sync', 0)

    // crush: phase quantisation (0 = off). Quantises the (post-sync) phase to
    // `crush` discrete steps before the wavetable lookup for a stepped, lo-fi timbre.
    evalMainParamFrame(vco.parameters.get('crush'), params, 'crush', 0)

    // unison: number of detuned voices; its `detune` subparam is the max frequency
    // ratio the voices spread across, evenly each side of the primary frequency.
    // The `amp` subparam is the centre-to-outer voice amplitude ratio (1 = equal).
    // The `pan` subparam is the stereo width the voices spread across (1/2 = 50%
    // left..50% right).
    evalMainParamFrame(vco.parameters.get('unison'), params, 'unison', 1)
    evalSubParamFrame(vco.parameters.get('unisonRatio'), params, 'unison', 'detune', 1.01)
    evalSubParamFrame(vco.parameters.get('unisonAmp'), params, 'unison', 'amp', 1)
    evalSubParamFrame(vco.parameters.get('unisonPan'), params, 'unison', 'pan', 0.5)

    waveEffects(params, effects(params, vco)).connect(vca)
    vco.start(params._time)
    vco.stop(params.endTime)
    params._destructor.disconnect(vca, vco)
  }
});
