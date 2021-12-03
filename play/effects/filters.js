'use strict';
define(function (require) {
  let system = require('play/system')
  let param = require('player/default-param')
  let {evalMainParamFrame} = require('play/eval-audio-params')

  let resonant = (params, node, type, prefix, defaultResonance) => {
    let freqParam = prefix+'f'
    if (!param(params[freqParam], 0)) { return node }
    let resonanceParam = prefix+'r'
    let filter = system.audio.createBiquadFilter()
    filter.type = type
    evalMainParamFrame(filter.frequency, params, freqParam)
    evalMainParamFrame(filter.Q, params, resonanceParam, defaultResonance)
    node.connect(filter)
    system.disconnect(params, [filter,node])
    return filter
  }

  let eq = (params, node, type, prefix, defaultFreq, defaultQ) => {
    let gainParam = prefix
    if (!param(params[gainParam], 0)) { return node }
    let freqParam = prefix+'f'
    let qParam = prefix+'q'
    let filter = system.audio.createBiquadFilter()
    filter.type = type
    evalMainParamFrame(filter.frequency, params, freqParam, defaultFreq)
    evalMainParamFrame(filter.gain, params, gainParam)
    evalMainParamFrame(filter.Q, params, qParam, defaultQ)
    node.connect(filter)
    system.disconnect(params, [filter,node])
    return filter
  }

  return (params, node) => {
    node = resonant(params, node, 'lowpass', 'lp', 5)
    node = resonant(params, node, 'highpass', 'hp', 5)
    node = resonant(params, node, 'bandpass', 'bp', 1)
    node = resonant(params, node, 'notch', 'n', 1)
    node = eq(params, node, 'lowshelf', 'low', 200, 0)
    node = eq(params, node, 'highshelf', 'high', 1100, 0)
    node = eq(params, node, 'peaking', 'mid', 600, 5)
    return node
  }
})
