'use strict';
define(function (require) {
  let system = require('play/system')

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
    lfoGain.gain.value = 1900
    lfo.connect(lfoGain)

    let output = system.audio.createGain()
    nodes.push(output)

    let makeAllPass = (freq) => {
      let ap = system.audio.createBiquadFilter()
      nodes.push(ap)
      ap.type='allpass'
      ap.Q.value = 0.1
      ap.frequency.value = freq
      lfoGain.connect(ap.detune)
      ap.connect(output)
      return ap
    }

    node
    .connect(makeAllPass(200))
    .connect(makeAllPass(400))
    .connect(makeAllPass(1100))
    .connect(makeAllPass(2100))
    return output
  }

  return phaser
})
