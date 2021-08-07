'use strict';
define(function (require) {
  let system = require('play/system')

  let phaser = (lfoFreq, node, nodes, oscs) => {
    if (lfoFreq == 0) { return node }

    let lfo = system.audio.createOscillator()
    nodes.push(lfo)
    oscs.push(lfo)
    lfo.frequency.value = lfoFreq
    lfo.start(system.audio.currentTime)

    let lfoGain = system.audio.createGain()
    nodes.push(lfoGain)
    lfoGain.gain.value = 1200
    lfo.connect(lfoGain)

    let mix = system.audio.createGain()
    nodes.push(mix)
    mix.gain.value = 1/2

    let makeAllPass = (freq) => {
      let ap = system.audio.createBiquadFilter()
      nodes.push(ap)
      ap.type='allpass'
      ap.Q.value = 0.125
      ap.frequency.value = freq
      lfoGain.connect(ap.detune)
      return ap
    }

    node
      .connect(makeAllPass(100))
      .connect(makeAllPass(200))
      .connect(makeAllPass(400))
      .connect(makeAllPass(800))
      .connect(mix)
    return mix
  }

  return phaser
})
