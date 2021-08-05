'use strict';
define(function (require) {
  let system = require('play/system')
  let param = require('player/default-param')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')
  let chain = require('play/effects/chains')

  let perFrameAmp = (params, node) => {
    if (typeof params.amp !== 'function') { return node } // No per frame control required
    let vca = system.audio.createGain()
    evalPerFrame(vca.gain, params, 'amp', 1)
    node.connect(vca)
    system.disconnect(params, [vca,node])
    return vca
  }

  let lpf = (params, node) => {
    if (!param(params.lpf, 0)) { return node }
    let lpf = system.audio.createBiquadFilter()
    lpf.type = 'lowpass'
    evalPerFrame(lpf.frequency, params, 'lpf')
    evalPerFrame(lpf.Q, params, 'lpr', 5)
    node.connect(lpf)
    system.disconnect(params, [lpf,node])
    return lpf
  }

  let hpf = (params, node) => {
    if (!param(params.hpf, 0)) { return node }
    let hpf = system.audio.createBiquadFilter()
    hpf.type = 'highpass'
    evalPerFrame(hpf.frequency, params, 'hpf')
    evalPerFrame(hpf.Q, params, 'hpr', 5)
    node.connect(hpf)
    system.disconnect(params, [hpf,node])
    return hpf
  }

  let bpf = (params, node) => {
    if (!param(params.bpf, 0)) { return node }
    let bpf = system.audio.createBiquadFilter()
    bpf.type = 'bandpass'
    evalPerFrame(bpf.frequency, params, 'bpf')
    evalPerFrame(bpf.Q, params, 'bpr', 1)
    node.connect(bpf)
    system.disconnect(params, [bpf,node])
    return bpf
  }

  let chop = (params, node) => {
    let chops = evalPerEvent(params, 'chop', 0)
    if (!chops) { return node }
    let lfo = system.audio.createOscillator()
    lfo.type = 'square';
    lfo.frequency.value = chops / params.beat.duration
    let gain = system.audio.createGain()
    gain.gain.setValueAtTime(1, params._time)
    lfo.connect(gain.gain)
    lfo.start(params._time)
    lfo.stop(params.endTime)
    node.connect(gain)
    system.disconnect(params, [gain,lfo,node])
    return gain
  }

  let pan = (params, node) => {
    if (!param(params.pan, 0)) { return node }
    let pan = system.audio.createStereoPanner()
    evalPerFrame(pan.pan, params, 'pan')
    node.connect(pan)
    system.disconnect(params, [pan,node])
    return pan
  }

  return (params, node) => {
    system.disconnect(params, [node])
    node = perFrameAmp(params, node)
    node = chop(params, node)
    node = lpf(params, node)
    node = hpf(params, node)
    node = bpf(params, node)
    node = pan(params, node)
    node = chain(params, node)
    return node
  }
})
