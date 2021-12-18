'use strict';
define(function (require) {
  let system = require('play/system')
  let param = require('player/default-param')
  let {evalMainParamFrame,evalSubParamFrame} = require('play/eval-audio-params')

  let resonant = (params, node, type, freqParam, defaultResonance) => {
    if (!param(params[freqParam], 0)) { return node }
    let filter = system.audio.createBiquadFilter()
    filter.type = type
    evalMainParamFrame(filter.frequency, params, freqParam)
    evalSubParamFrame(filter.Q, params, freqParam, 'q', defaultResonance)
    node.connect(filter)
    system.disconnect(params, [filter,node])
    return filter
  }

  let eq = (params, node, type, gainParam, defaultFreq, defaultQ) => {
    if (!param(params[gainParam], 0)) { return node }
    let filter = system.audio.createBiquadFilter()
    filter.type = type
    evalMainParamFrame(filter.gain, params, gainParam)
    evalSubParamFrame(filter.frequency, params, gainParam, 'freq', defaultFreq)
    evalSubParamFrame(filter.Q, params, gainParam, 'q', defaultQ)
    node.connect(filter)
    system.disconnect(params, [filter,node])
    return filter
  }

  return (params, node) => {
    node = resonant(params, node, 'lowpass', 'lpf', 5)
    node = resonant(params, node, 'highpass', 'hpf', 5)
    node = resonant(params, node, 'bandpass', 'bpf', 1)
    node = resonant(params, node, 'notch', 'nf', 1)
    node = eq(params, node, 'lowshelf', 'low', 200, 0)
    node = eq(params, node, 'highshelf', 'high', 1100, 0)
    node = eq(params, node, 'peaking', 'mid', 600, 5)
    return node
  }
})
