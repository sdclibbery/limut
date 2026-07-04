'use strict'
define(function(require) {
  let {addNodeFunction,combineParams} = require('play/nodes/node-var')
  let system = require('play/system');
  let {evalMainParamEvent,evalSubParamEvent,evalMainParamFrame,evalSubParamFrame} = require('play/eval-audio-params')
  let {evalParamFrame,evalParamEvent} = require('player/eval-param')
  let createSuperOsc = require('play/superosc-source')
  let setWave = require('play/synth/waveforms/set-wave')
  let whiteNoise = require('play/synth/waveforms/noise')
  let click = require('play/synth/waveforms/click')
  let {getBuffer} = require('play/samples')
  let {getTtsBuffer} = require('play/tts')
  let {mainParamUnits} = require('player/sub-param')
  let metronome = require('metronome')

  let osc = (args,e,b) => {
    let node = system.audio.createOscillator()
    let params = combineParams(args, e)
    let value = evalParamEvent(params.value, e,b)
    setWave(node, (typeof value === 'string') ? value : 'sawtooth')
    let freq = 440
    if (typeof value === 'number' && value !== 0) {
      evalMainParamFrame(node.frequency, params, 'value', 440, 'hz')
      freq = evalParamEvent(params['value'], e)
    } else {
      evalMainParamFrame(node.frequency, params, 'freq', 440, 'hz')
      freq = evalParamEvent(params['freq'], e)
    }
    let phase = evalParamEvent(params['phase'], e)
    let offset = 0
    if (typeof freq === 'number' && typeof phase === 'number') { offset = phase / freq }
    node.start(e._time + offset)
    if (e && e._destructor) { e._destructor.stop(node) } else { node.stop() }
    return node
  }
  addNodeFunction('osc', osc)

  // Audio-worklet wavetable oscillator source node, so a superosc can be wired into an fx chain
  // like any other source, eg `superosc{440} >> lpf{800}`. `value`/`freq` set the frequency
  // in Hz and `detune` shifts it in cents, mirroring the native `osc` node. `wavetable` is a
  // sample URL sliced into `count` single-cycle frames (default 64), and `wt` (0..1) morphs
  // across them. `pwm` power-warps the phase (2^pwm), skewing the waveform toward its start
  // or end like a generalised pulse width (0 = off). `unison` layers that many detuned voices (its `detune` subparam is the max
  // frequency ratio they spread across, its `amp` subparam the centre-to-outer voice
  // amplitude ratio, and its `pan` subparam the stereo width they spread across). Intended
  // to grow more functionality over time.
  let superosc = (args,e,b) => {
    if (!window.AudioWorkletNode) { return }
    let params = combineParams(args, e)
    // Stereo output only when there are 2+ unison voices AND a non-zero pan
    // spread (evaluated once at note start); otherwise every voice is centred so
    // a mono node is enough and keeps the downstream fx chain mono (cheaper).
    let unison = evalMainParamEvent(params, 'unison', 1)
    let pan = evalSubParamEvent(params, 'unison', 'pan', 0.5)
    let node = createSuperOsc(Math.round(unison) >= 2 && pan !== 0 ? 2 : 1)
    let value = evalParamEvent(params.value, e,b)
    if (typeof value === 'number' && value !== 0) {
      evalMainParamFrame(node.parameters.get('frequency'), params, 'value', 440, 'hz')
    } else {
      evalMainParamFrame(node.parameters.get('frequency'), params, 'freq', 440, 'hz')
    }
    evalMainParamFrame(node.parameters.get('detune'), params, 'detune', 0)
    // Wavetable sample buffer, sliced into `count` single-cycle frames (count is
    // a subparam of wavetable, eg wavetable:{'...', count:64}, default 64); silent
    // until the sample loads, then switched in via the worklet's message port.
    // `wt` (0..1) morphs across the frames.
    let wavetableUrl = evalMainParamEvent(params, 'wavetable', undefined)
    if (wavetableUrl) {
      let count = evalSubParamEvent(params, 'wavetable', 'count', 64)
      let buf = getBuffer(wavetableUrl, (b) => node.setWave(b.getChannelData(0), count))
      if (buf) { node.setWave(buf.getChannelData(0), count) }
    }
    evalMainParamFrame(node.parameters.get('wt'), params, 'wt', 0)
    // sync: oscillator hard-sync ratio (0 = off); remaps the phase to restart
    // |sync| times per fundamental cycle for the classic hard-sync timbre;
    // negative sync uses the same ratio but crossfades the reset (soft sync).
    evalMainParamFrame(node.parameters.get('sync'), params, 'sync', 0)
    // crush: phase quantisation (0 = off); quantises the (post-sync) phase to
    // `crush` steps before the wavetable lookup for a stepped, lo-fi timbre.
    evalMainParamFrame(node.parameters.get('crush'), params, 'crush', 0)
    // pwm: phase power-warp (0 = off); raises the (post-sync) phase to the power
    // 2^pwm before the lookup, skewing the waveform toward its start (pwm>0) or
    // end (pwm<0) like a generalised pulse width.
    evalMainParamFrame(node.parameters.get('pwm'), params, 'pwm', 0)
    // formant: formant/warp shift (0 = off); resamples the waveform within each
    // cycle at 2^formant times the rate (windowed to keep the pitch), shifting the
    // formants up (formant>0) or down (formant<0) like Serum/Vital's formant warp.
    evalMainParamFrame(node.parameters.get('formant'), params, 'formant', 0)
    // unison: number of detuned voices; `detune` subparam is the max frequency
    // ratio the voices spread across, evenly each side of the primary frequency.
    // `amp` subparam is the centre-to-outer voice amplitude ratio (1 = equal).
    // `pan` subparam is the stereo width the voices spread across (1/2 = 50%
    // left..50% right).
    evalMainParamFrame(node.parameters.get('unison'), params, 'unison', 1)
    evalSubParamFrame(node.parameters.get('unisonRatio'), params, 'unison', 'detune', 1.01)
    evalSubParamFrame(node.parameters.get('unisonAmp'), params, 'unison', 'amp', 1)
    evalSubParamFrame(node.parameters.get('unisonPan'), params, 'unison', 'pan', 0.5)
    node.start(e._time)
    if (e && e._destructor) { e._destructor.stop(node) } else { node.stop() }
    return node
  }
  addNodeFunction('superosc', superosc)

  let constNode = (args,e,b) => {
    let node = system.audio.createConstantSource()
    let params = combineParams(args, e)
    evalMainParamFrame(node.offset, params, 'value', 1)
    node.start(e._time)
    if (e && e._destructor) { e._destructor.stop(node) } else { node.stop() }
    return node
  }
  addNodeFunction('const', constNode)

  // Looping white-noise source node, so noise can be wired into an fx chain like any other
  // source, eg `noise{} >> lpf{800}`. Uses the same cached white-noise buffer as the noise synth.
  // `rate` changes playback speed/pitch like a sample. Starts at a random offset into the 2s
  // buffer so repeated events don't phase-lock.
  let noise = (args,e,b) => {
    let node = whiteNoise.white()
    let params = combineParams(args, e)
    evalMainParamFrame(node.playbackRate, params, 'rate', 1)
    node.start(e._time, Math.random()*2)
    if (e && e._destructor) { e._destructor.stop(node) } else { node.stop() }
    return node
  }
  addNodeFunction('noise', noise)

  // One-shot click (1ms impulse) source node, eg `impulse{} >> reverb{room:0.9}` to excite an
  // effect's impulse response. Uses the same cached click buffer as the impulse synth. `rate`
  // changes playback speed like a sample. Does not loop.
  let impulse = (args,e,b) => {
    let node = click.click()
    let params = combineParams(args, e)
    evalMainParamFrame(node.playbackRate, params, 'rate', 1)
    node.start(e._time)
    if (e && e._destructor) { e._destructor.stop(node) } else { node.stop() }
    return node
  }
  addNodeFunction('impulse', impulse)

  let sample = (args,e,b) => {
    let node = system.audio.createBufferSource()
    let params = combineParams(args, e)
    let value = params.sample !== undefined ? params.sample : args.value
    let startTime = 0
    // A buffer source can't be re-buffered once started, and an fx chain is built one at
    // event time, so when the sample is still loading we defer node.start until the buffer
    // lands (rebased to now) rather than starting silent forever. Mirrors the tts node below.
    let deferredBuffer
    let started = false
    let begin = (buffer, when) => {
      if (started || !buffer) { return }
      started = true
      node.buffer = buffer
      node.start(when, startTime)
      if (e && e._destructor) { e._destructor.stop(node) } else { node.stop() }
    }
    let evalledValue = evalParamEvent(value, e,b)
    if (typeof evalledValue === 'string') { value = evalledValue }
    if (typeof value === 'string' || value === undefined) {
      if (value === undefined) { value = 'sample/salamander/C4v8.mp3' }
      startTime = evalMainParamEvent(params, 'start', 0, 's')
      deferredBuffer = getBuffer(value, (buf) => begin(buf, system.audio.currentTime + metronome.advance()))
    } else {
      const length = evalMainParamEvent(params, 'length', 0.2, 's')
      const sampleRate = system.audio.sampleRate
      let buffer = system.audio.createBuffer(1, length*sampleRate, sampleRate)
      let data = buffer.getChannelData(0)
      args.value.modifiers = args.value.modifiers || {}
      for (var i = 0; i < data.length; i++) {
        args.value.modifiers.value = i / data.length
        let y = evalParamFrame(args.value,e,b, {doNotMemoise:true}) // It will memoise the same result across all x if allowed to
        data[i] = y
      }
      deferredBuffer = buffer
    }
    evalMainParamFrame(node.playbackRate, params, 'rate', 1)
    node.loop = params.loop === undefined || params.loop === true ? true : false // Default to looping if not set
    if (params.loopstart !== undefined && params.looplen !== undefined) {
      node.loopStart = mainParamUnits(evalParamFrame(params.loopstart,params,e.count), 0, 's')
      node.loopEnd = node.loopStart + mainParamUnits(evalParamFrame(params.looplen,params,e.count), 1, 's')
      node.loop = true
      system.add(params._time, (state) => {
        let __event = params !== undefined && params.__event ? params.__event : params
        if (__event && state.time > __event.endTime) { return false }
        if (__event && state.time < __event._time) { return true }
        node.loopStart = mainParamUnits(evalParamFrame(params.loopstart,params,state.count), 0, 's')
        node.loopEnd = node.loopStart + mainParamUnits(evalParamFrame(params.looplen,params,state.count), 1, 's')
        return true
      })
    }
    if (deferredBuffer) { begin(deferredBuffer, e._time) } // ready synchronously: start on the event
    return node
  }
  addNodeFunction('sample', sample)

  // The espeak voice options that change the synthesized audio. These form part of the
  // cache key in play/tts.js; pitch shifting by note is applied later via playbackRate
  // (like sample) and is intentionally NOT part of the key. Mirrors play/synth/tts.js.
  let ttsVoiceOpts = (params) => {
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

  // Text-to-speech source node: synthesizes the given text to an AudioBuffer (cached in
  // play/tts.js) and plays it through a buffer source, so speech can be wired into an fx
  // chain like any other source (eg `tts{'hello'} >> lpf{800}`). Unlike `sample` it does
  // not loop by default. The buffer source can't be re-buffered once started, so we defer
  // node.start until the buffer exists: cached phrases start exactly on the event, while a
  // first-use phrase synthesizes in the background and starts (rebased to now) as soon as
  // its buffer lands, mirroring play/synth/tts.js.
  let tts = (args,e,b) => {
    let node = system.audio.createBufferSource()
    let params = combineParams(args, e)
    let value = params.text !== undefined ? params.text : args.value
    let text = evalParamEvent(value, e,b)
    if (typeof text !== 'string') { text = '' }
    evalMainParamFrame(node.playbackRate, params, 'rate', 1)
    node.loop = params.loop === true ? true : false // Speech plays once unless explicitly looped
    let started = false
    let begin = (buffer, when) => {
      if (started || !buffer) { return }
      started = true
      node.buffer = buffer
      node.start(when)
      if (e && e._destructor) { e._destructor.stop(node) }
    }
    let buffer = getTtsBuffer(text, ttsVoiceOpts(params), (buf) => begin(buf, system.audio.currentTime + metronome.advance()))
    if (buffer) { begin(buffer, e._time) }
    return node
  }
  addNodeFunction('tts', tts)
})
