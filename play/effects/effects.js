'use strict';
define(function (require) {
  let system = require('play/system')
  let param = require('player/default-param')
  let {evalMainParamFrame,evalSubParamFrame,evalSubParamEvent,fixedPerFrame} = require('play/eval-audio-params')
  let chain = require('play/effects/chains')
  let filters = require('play/effects/filters')

  let mixLerp = (mix) => {
    if (mix < 0.01) { mix = 0.01 }
    if (mix > 1) { mix = 1 }
    return Math.sin(mix * 0.5*Math.PI)
  }
  let dryGain = (mix) => {
    let lerp = mixLerp(mix)
      // Actual lerp would require a 3rd gain node to sum the dry and wet: wet*m + dry*(1-m)
      // Modified lerp can be done with two gain nodes: m*(wet + dry*(1-m)/m)
      return (1-lerp)/lerp
  }
  let outGain = (mix) => mixLerp(mix)
  let mix = (params, p, dry, wet, def) => {
    if (def === undefined) { def = 1 }
    if (fixedPerFrame(params, p, 'mix', def)) {
      let mix = evalSubParamEvent(params, p, 'mix', def)
      if (mix <= 0.01) { return dry }
      if (mix >= 1) { return wet }
      let dryGainNode = system.audio.createGain()
      dryGainNode.gain.value = dryGain(mix)
      dry.connect(dryGainNode)
      let outGainNode = system.audio.createGain()
      outGainNode.gain.value = outGain(mix)
      wet.connect(outGainNode)
      dryGainNode.connect(outGainNode)
      system.disconnect(params, [dryGainNode,outGainNode])
      return outGainNode
    } else {
      // per frame
      let dryGainNode = system.audio.createGain()
      dry.connect(dryGainNode)
      let outGainNode = system.audio.createGain()
      wet.connect(outGainNode)
      dryGainNode.connect(outGainNode)
      evalSubParamFrame(dryGainNode.gain, params, p, 'mix', def, mix => dryGain(mix))
      evalSubParamFrame(outGainNode.gain, params, p, 'mix', def, mix => outGain(mix))
      system.disconnect(params, [dryGainNode,outGainNode])
      return outGainNode
    }
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
