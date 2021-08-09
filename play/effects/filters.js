'use strict';
define(function (require) {
  let system = require('play/system')
  let param = require('player/default-param')
  let {evalPerFrame} = require('play/eval-audio-params')

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

  return (params, node) => {
    node = lpf(params, node)
    node = hpf(params, node)
    node = bpf(params, node)
    return node
  }
})
