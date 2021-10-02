'use strict';
define(function (require) {
  let system = require('play/system')
  let param = require('player/default-param')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')
  let chain = require('play/effects/chains')
  let filters = require('play/effects/filters')

  let perFrameAmp = (params, node) => {
    if (typeof params.amp !== 'function') { return node } // No per frame control required
    let vca = system.audio.createGain()
    evalPerFrame(vca.gain, params, 'amp', 1)
    node.connect(vca)
    system.disconnect(params, [vca,node])
    return vca
  }

  let chop = (params, node) => {
    let chops = evalPerEvent(params, 'chop', 0)
    if (!chops) { return node }
    let lfo = system.audio.createOscillator()
    lfo.type = 'square';
    lfo.frequency.value = chops / params.beat.duration
    let gain = system.audio.createGain()
    gain.gain.setValueAtTime(1, system.audio.currentTime)
    lfo.connect(gain.gain)
    lfo.start(params._time)
    lfo.stop(params.endTime)
    node.connect(gain)
    system.disconnect(params, [gain,lfo,node])
    return gain
  }

  let ring = (params, node) => {
    let freq = evalPerEvent(params, 'ring', 0)
    if (!freq) { return node }
    let lfo = system.audio.createOscillator()
    lfo.type = 'triangle';
    lfo.frequency.value = freq
    let gain = system.audio.createGain()
    gain.gain.setValueAtTime(0, system.audio.currentTime)
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
    node = ring(params, node)
    node = filters(params, node)
    node = pan(params, node)
    node = chain(params, node)
    return node
  }
})
