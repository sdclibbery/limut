'use strict';
define(function (require) {
  let system = require('play/system')
  let metronome = require('metronome')
  let {mainParam} = require('player/sub-param')
  let {evalMainParamFrame,evalSubParamEvent} = require('play/eval-audio-params')
  let filters = require('play/effects/filters')
  let {mix} = require('play/effects/mix')

  let chop = (params, node) => {
    if (!mainParam(params.chop, 0)) { return node }
    let lfo = system.audio.createOscillator()
    lfo.type = evalSubParamEvent(params, 'chop', 'wave', 'sine')
    evalMainParamFrame(lfo.frequency, params, 'chop', 1, 'cpb', v => v / metronome.beatDuration())
    let gain = system.audio.createGain()
    gain.gain.setValueAtTime(1, system.audio.currentTime)
    lfo.connect(gain.gain)
    lfo.start(params._time)
    node.connect(gain)
    let output = system.audio.createGain()
    output.gain.setValueAtTime(1/2, system.audio.currentTime)
    gain.connect(output)
    params._destructor.stop(lfo)
    params._destructor.disconnect(gain, lfo, node, output)
    return mix(params, 'chop', node, output, 1)
  }

  let ring = (params, node) => {
    if (!mainParam(params.ring, 0)) { return node }
    let lfo = system.audio.createOscillator()
    lfo.type = evalSubParamEvent(params, 'ring', 'wave', 'triangle')
    evalMainParamFrame(lfo.frequency, params, 'ring', 1, 'hz')
    let gain = system.audio.createGain()
    gain.gain.setValueAtTime(0, system.audio.currentTime)
    lfo.connect(gain.gain)
    lfo.start(params._time)
    node.connect(gain)
    params._destructor.stop(lfo)
    params._destructor.disconnect(gain, lfo, node)
    return mix(params, 'ring', node, gain, 1)
  }

  let mono = (params, node) => {
    if (!mainParam(params.mono, 0)) { return node }
    let mixer = system.audio.createGain(1)
    mixer.channelCount=1
    mixer.channelCountMode = 'explicit'
    node.connect(mixer)
    return mixer
  }

  let pan = (params, node) => {
    if (!mainParam(params.pan, 0)) { return node }
    let pan = system.audio.createStereoPanner()
    evalMainParamFrame(pan.pan, params, 'pan')
    node.connect(pan)
    params._destructor.disconnect(pan, node)
    return pan
  }

  return (params, node) => {
    node = chop(params, node)
    node = ring(params, node)
    node = filters(params, node)
    node = mono(params, node)
    node = pan(params, node)
    return node
  }
})
