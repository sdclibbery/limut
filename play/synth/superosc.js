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
    // wavetable set it defaults to a single-cycle saw (sample/wave/SAW.WAV, count 1)
    // so a bare superosc makes sound. When the sample loads (sync or async via the
    // samples cache) it is pushed to the worklet, which switches to it in place.
    // `wt` (0..1) morphs across the frames.
    let wavetableUrl = evalMainParamEvent(params, 'wavetable', undefined)
    let defaultCount = 64
    if (!wavetableUrl) { wavetableUrl = 'sample/wave/SAW.WAV'; defaultCount = 1 }
    let count = evalSubParamEvent(params, 'wavetable', 'count', defaultCount)
    let smooth = evalSubParamEvent(params, 'wavetable', 'smooth', 0)
    let buf = getBuffer(wavetableUrl, (b) => vco.setWave(b.getChannelData(0), count, smooth))
    if (buf) { vco.setWave(buf.getChannelData(0), count, smooth) }
    evalMainParamFrame(vco.parameters.get('wt'), params, 'wt', 0)

    // sync: oscillator hard-sync ratio (0 = off). Remaps the phase to restart
    // |sync| times per fundamental cycle for the classic hard-sync timbre;
    // negative sync uses the same ratio but crossfades the reset (soft sync).
    evalMainParamFrame(vco.parameters.get('sync'), params, 'sync', 0)

    // crush: phase quantisation in bits (0 = off). Quantises the (post-sync) phase
    // to `2^crush` steps before the wavetable lookup for a stepped, lo-fi timbre.
    evalMainParamFrame(vco.parameters.get('crush'), params, 'crush', 0)

    // pwm: phase power-warp (0 = off). Raises the (post-sync) phase to the power
    // 2^pwm before the lookup, skewing the waveform toward its start (pwm>0) or
    // end (pwm<0) like a generalised pulse width.
    evalMainParamFrame(vco.parameters.get('pwm'), params, 'pwm', 0)

    // formant: formant/warp shift (0 = off). Resamples the waveform within each
    // cycle at 2^formant times the rate (windowed to keep the pitch), shifting the
    // spectral formants up (formant>0) or down (formant<0) like Serum/Vital's
    // formant warp.
    evalMainParamFrame(vco.parameters.get('formant'), params, 'formant', 0)

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
    // Register the worklet with the destructor (like every other source synth,
    // eg wave.js) rather than scheduling stop() against endTime here: for live
    // (keyboard/gamepad) notes endTime is a _time+1e6 placeholder at build time,
    // so a build-time vco.stop(endTime) never fires and the worklet's process()
    // runs forever after release, leaking render capacity. The destructor stops
    // it at the real destroy time (release for live notes), so it self-terminates.
    params._destructor.disconnect(vca, vco)
    params._destructor.stop(vco)
  }
});
