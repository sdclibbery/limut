'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalSubParamFrame,evalSubParamEvent,fixedPerFrame} = require('play/eval-audio-params')

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

  let fixedMix = (destructor, mix, dry, wet) => {
    if (mix <= 0.01) { return dry }
    if (mix >= 1) { return wet }
    let dryGainNode = system.audio.createGain()
    dryGainNode.gain.value = dryGain(mix)
    dry.connect(dryGainNode)
    let outGainNode = system.audio.createGain()
    outGainNode.gain.value = outGain(mix)
    dryGainNode.connect(outGainNode)
    wet.connect(outGainNode)
    destructor.disconnect(dryGainNode,outGainNode)
    return outGainNode
  }

  let mix = (params, p, dry, wet, def) => {
    if (def === undefined) { def = 1 }
    if (fixedPerFrame(params, p, 'mix', def)) {
      let mix = evalSubParamEvent(params, p, 'mix', def)
      let outNode = fixedMix(params._destructor, mix, dry, wet)
      return outNode
    } else {
      // per frame
      let dryGainNode = system.audio.createGain()
      dry.connect(dryGainNode)
      let outGainNode = system.audio.createGain()
      wet.connect(outGainNode)
      dryGainNode.connect(outGainNode)
      evalSubParamFrame(dryGainNode.gain, params, p, 'mix', def, mix => dryGain(mix))
      evalSubParamFrame(outGainNode.gain, params, p, 'mix', def, mix => outGain(mix))
      params._destructor.disconnect(dryGainNode, outGainNode)
      return outGainNode
    }
  }

  return {
    mix:mix,
    fixedMix:fixedMix,
  }
})
