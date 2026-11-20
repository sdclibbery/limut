'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalSubParamFrame,evalSubParamEvent,fixedPerFrame} = require('play/eval-audio-params')

  // 'sum' keeps dry+wet amplitude at 1, for a wet that is a reshaped copy of the dry (drive, chop).
  // 'power' keeps dry^2+wet^2 at 1, for a wet uncorrelated with the dry (reverb, ring), which would
  // otherwise dip 3dB mid mix. Both have wet = sin(mix*pi/2).
  let laws = {
    sum: (mix) => [1 - Math.sin(mix * 0.5*Math.PI), Math.sin(mix * 0.5*Math.PI)],
    power: (mix) => [Math.cos(mix * 0.5*Math.PI), Math.sin(mix * 0.5*Math.PI)],
  }

  // Two gain nodes, not three: out = wet*w + dry*d is built as w*(wet + dry*d/w)
  let clampMix = (mix) => Math.min(Math.max(mix, 0.01), 1)
  let dryGain = (law, mix) => { let [d, w] = laws[law](clampMix(mix)); return d/w }
  let outGain = (law, mix) => laws[law](clampMix(mix))[1]

  let fixedMix = (destructor, mix, dry, wet, law) => {
    law = law || 'sum'
    if (mix <= 0.01) { return dry }
    if (mix >= 1) { return wet }
    let dryGainNode = system.audio.createGain()
    dryGainNode.gain.value = dryGain(law, mix)
    dry.connect(dryGainNode)
    let outGainNode = system.audio.createGain()
    outGainNode.gain.value = outGain(law, mix)
    dryGainNode.connect(outGainNode)
    wet.connect(outGainNode)
    destructor.disconnect(dryGainNode,outGainNode)
    return outGainNode
  }

  let mix = (params, p, dry, wet, def, law) => {
    if (def === undefined) { def = 1 }
    law = law || 'sum'
    if (fixedPerFrame(params, p, 'mix', def)) {
      let mix = evalSubParamEvent(params, p, 'mix', def)
      let outNode = fixedMix(params._destructor, mix, dry, wet, law)
      return outNode
    } else {
      // per frame
      let dryGainNode = system.audio.createGain()
      dry.connect(dryGainNode)
      let outGainNode = system.audio.createGain()
      wet.connect(outGainNode)
      dryGainNode.connect(outGainNode)
      evalSubParamFrame(dryGainNode.gain, params, p, 'mix', def, undefined, mix => dryGain(law, mix))
      evalSubParamFrame(outGainNode.gain, params, p, 'mix', def, undefined, mix => outGain(law, mix))
      params._destructor.disconnect(dryGainNode, outGainNode)
      return outGainNode
    }
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual, msg) => {
      if (Math.abs(expected - actual) > 0.0001) { console.trace(`Assertion failed ${msg||''}.\n>>Expected: ${expected}\n>>Actual:   ${actual}`) }
    }
    let levels = (law, mix) => [dryGain(law, mix)*outGain(law, mix), outGain(law, mix)]
    let [d, w] = levels('sum', 1/2)
    assert(1, d + w, 'sum law: amplitudes sum to 1')
    assert(Math.SQRT1_2, w, 'sum law wet at 1/2')
    ;[d, w] = levels('power', 1/2)
    assert(1, d*d + w*w, 'power law: powers sum to 1')
    assert(Math.SQRT1_2, d, 'power law dry at 1/2')
    ;[d, w] = levels('power', 3/4)
    let [od, ow] = levels('sum', 1/2)
    assert(ow/od, w/d, 'room default 3/4 power keeps the old 1/2 sum balance')
    ;[d, w] = levels('power', 1/2)
    ;[od, ow] = levels('sum', 1/3)
    assert(ow/od, w/d, 'reverb default 1/2 power keeps the old 1/3 sum balance')
    console.log('Mix tests complete')
  }

  return {
    mix:mix,
    fixedMix:fixedMix,
  }
})
