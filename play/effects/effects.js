'use strict';
define(function (require) {
  let system = require('play/system')
  let param = require('player/default-param')
  let {evalMainParamFrame,evalSubParamEvent} = require('play/eval-audio-params')
  let chain = require('play/effects/chains')
  let filters = require('play/effects/filters')

  let mix = (params, param, dry, wet, def) => {
    if (def === undefined) { def = 1 }
    let mix = evalSubParamEvent(params, param, 'mix', def)
    if (mix <= 0) { return dry }
    if (mix >= 1) { return wet }
    let lerp = Math.sin(mix * 0.5*Math.PI)
    // Actual lerp would require a 3rd gain node to sum the dry and wet: wet*m + dry*(1-m)
    // Modified lerp can be done with two gain nodes: m*(wet + dry*(1-m)/m)
    let dryGain = (1-lerp)/lerp
    let wetGain = lerp
    let dryGainNode = system.audio.createGain()
    dryGainNode.gain.value = dryGain
    dry.connect(dryGainNode)
    let outGainNode = system.audio.createGain()
    outGainNode.gain.value = wetGain
    wet.connect(outGainNode)
    dryGainNode.connect(outGainNode)
    system.disconnect(params, [dryGainNode,outGainNode])
    return outGainNode
  }

  let perFrameAmp = (params, node) => {
    if (typeof params.amp !== 'function') { return node } // No per frame control required
    let vca = system.audio.createGain()
    evalMainParamFrame(vca.gain, params, 'amp', 1)
    node.connect(vca)
    system.disconnect(params, [vca,node])
    return vca
  }

  let chop = (params, node) => {
    if (params['chop'] === undefined) { return node }
    let lfo = system.audio.createOscillator()
    lfo.type = evalSubParamEvent(params, 'chop', 'wave', 'sine')
    evalMainParamFrame(lfo.frequency, params, 'chop', 1, v => v / params.beat.duration)
    let gain = system.audio.createGain()
    gain.gain.setValueAtTime(1, system.audio.currentTime)
    lfo.connect(gain.gain)
    lfo.start(params._time)
    lfo.stop(params.endTime)
    node.connect(gain)
    system.disconnect(params, [gain,lfo,node])
    return mix(params, 'chop', node, gain, 1)
  }

  let ring = (params, node) => {
    if (params['ring'] === undefined) { return node }
    let lfo = system.audio.createOscillator()
    lfo.type = evalSubParamEvent(params, 'ring', 'wave', 'triangle')
    evalMainParamFrame(lfo.frequency, params, 'ring', 1)
    let gain = system.audio.createGain()
    gain.gain.setValueAtTime(0, system.audio.currentTime)
    lfo.connect(gain.gain)
    lfo.start(params._time)
    lfo.stop(params.endTime)
    node.connect(gain)
    system.disconnect(params, [gain,lfo,node])
    return mix(params, 'ring', node, gain, 1)
  }

  let pan = (params, node) => {
    if (!param(params.pan, 0)) { return node }
    let pan = system.audio.createStereoPanner()
    evalMainParamFrame(pan.pan, params, 'pan')
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
