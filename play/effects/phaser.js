'use strict';
define(function (require) {
  let system = require('play/system')

  let makeAllPass = (nodes, freq, q, lfoGain) => {
    let ap = system.audio.createBiquadFilter()
    nodes.push(ap)
    ap.type='allpass'
    ap.Q.value = q
    ap.frequency.value = freq
    lfoGain.connect(ap.detune)
    return ap
  }

let phaser = (lfoFreq, node, nodes, oscs) => {
    if (lfoFreq == 0) { return node }

    let lfo = system.audio.createOscillator()
    lfo.type= 'triangle'
    nodes.push(lfo)
    oscs.push(lfo)
    lfo.frequency.value = lfoFreq
    lfo.start(system.audio.currentTime)

    let lfoGain = system.audio.createGain()
    nodes.push(lfoGain)
    lfoGain.gain.value = 2600
    lfo.connect(lfoGain)

    let output = system.audio.createGain()
    nodes.push(output)

    let ap
    ap = makeAllPass(nodes, 200, 0.7, lfoGain)
    node.connect(ap)
    ap.connect(output)

    ap = makeAllPass(nodes, 1700, 0.7, lfoGain)
    node.connect(ap)
    ap.connect(output)

    return output
  }

  return phaser
})
