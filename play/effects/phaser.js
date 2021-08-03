'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalPerEvent} = require('play/eval-audio-params')

  let phaser = (params, node) => {
    let lfoFreq = evalPerEvent(params, 'phaser', 0)
    if (lfoFreq == 0) { return node }

    let lfo = system.audio.createOscillator()
    lfo.frequency.value = lfoFreq / params.beat.duration
    lfo.start(params._time)
    lfo.stop(params.endTime)

    let lfoGain = system.audio.createGain()
    lfoGain.gain.value = 1200
    lfo.connect(lfoGain)

    let mix = system.audio.createGain()
    mix.gain.value = 1/2
    node.connect(mix)

    let aps = []
    let makeAllPass = (freq) => {
      let ap = system.audio.createBiquadFilter()
      ap.type='allpass'
      ap.Q.value = 0.125
      ap.frequency.value = freq
      lfoGain.connect(ap.detune)
      aps.push(ap)
      return ap
    }

    node
      .connect(makeAllPass(100))
      .connect(makeAllPass(200))
      .connect(makeAllPass(400))
      .connect(makeAllPass(800))
      .connect(mix)
    system.disconnect(params, aps.concat([node,lfo,mix,lfoGain]))
    return mix
  }

  return phaser
})
