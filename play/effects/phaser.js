'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalMainParamFrame} = require('play/eval-audio-params')
  let {mix} = require('play/effects/mix')
  let {mainParam} = require('player/sub-param')

  let makeAllPass = (destructor, freq, q, lfoGain) => {
    let ap = system.audio.createBiquadFilter()
    destructor.disconnect(ap)
    ap.type='allpass'
    ap.Q.value = q
    ap.frequency.value = freq
    lfoGain.connect(ap.detune)
    return ap
  }

let phaser = (destructor, params, lfoFreq, node) => {
    let lfo = system.audio.createOscillator()
    lfo.type= 'triangle'
    destructor.disconnect(lfo)
    destructor.stop(lfo)
    if (!!params) {
      evalMainParamFrame(lfo.frequency, params, 'phaser', 1)
    } else {
      lfo.frequency.value = lfoFreq
    }
    lfo.start(system.audio.currentTime)

    let lfoGain = system.audio.createGain()
    destructor.disconnect(lfoGain)
    lfoGain.gain.value = 2600
    lfo.connect(lfoGain)

    let output = system.audio.createGain()
    destructor.disconnect(output)

    let ap
    ap = makeAllPass(destructor, 200, 0.7, lfoGain)
    node.connect(ap)
    ap.connect(output)

    ap = makeAllPass(destructor, 1700, 0.7, lfoGain)
    node.connect(ap)
    ap.connect(output)

    return output
  }

  let fixedPhaser = (destructor, lfoFreq, node) => {
    if (lfoFreq == 0) { return node }
    return phaser(destructor, undefined, lfoFreq, node)
  }

  let mixedPhaser = (params, node) => {
    if (!mainParam(params.phaser, 0)) { return node }
    let phaserNode = phaser(params._destructor, params, undefined, node)
    return mix(params, 'phaser', node, phaserNode, 1)
  }

  return {
    fixedPhaser: fixedPhaser,
    mixedPhaser: mixedPhaser,
  }
})
