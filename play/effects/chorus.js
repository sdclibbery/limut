'use strict';
define(function (require) {
  let system = require('play/system')

  // Inspired by https://www.soundonsound.com/techniques/more-creative-synthesis-delays

  let chorus = (chorusAmount, node, nodes) => {
    if (!chorusAmount) { return node }

    let lfoLf1, lfoLf2, lfoLf3
    let lfoHfSrc, lfoHf
    let bias
    const lfoHfGain = 0.12
  
    const lfFreq = 0.62165132
    lfoLf1 = system.audio.createOscillator()
    nodes.push(lfoLf1)
    lfoLf1.frequency.value = lfFreq
    lfoLf1.start(system.audio.currentTime)

    lfoLf2 = system.audio.createOscillator()
    nodes.push(lfoLf2)
    lfoLf2.frequency.value = lfFreq
    lfoLf2.start(system.audio.currentTime+0.333/lfFreq)

    lfoLf3 = system.audio.createOscillator()
    nodes.push(lfoLf3)
    lfoLf3.frequency.value = lfFreq
    lfoLf3.start(system.audio.currentTime+0.667/lfFreq)

    lfoHfSrc = system.audio.createOscillator()
    nodes.push(lfoHfSrc)
    lfoHfSrc.frequency.value = 6.674325
    lfoHfSrc.start(system.audio.currentTime)
    lfoHf = system.audio.createGain()
    nodes.push(lfoHf)
    lfoHf.gain.value = lfoHfGain
    lfoHfSrc.connect(lfoHf)

    bias = system.audio.createConstantSource()
    nodes.push(bias)
    bias.start()
    bias.offset.value = 1.1

    let makeDelay = (lfo1, lfo2) => {
      let lfoGain = system.audio.createGain()
      nodes.push(lfoGain)
      lfo1.connect(lfoGain)
      lfo2.connect(lfoGain)
      bias.connect(lfoGain)
  
      const maxDelay = 40/1000
      const lfoNormalise = 2*(1 + bias.offset.value + lfoHfGain)
      lfoGain.gain.value = (chorusAmount/8)*maxDelay/lfoNormalise
  
      let delay = system.audio.createDelay(maxDelay*1.25)
      nodes.push(delay)
      lfoGain.connect(delay.delayTime)
  
      return delay
    }
  
    let d1 = makeDelay(lfoLf1, lfoHf)
    node.connect(d1)
    let d2 = makeDelay(lfoLf2, lfoHf)
    node.connect(d2)
    let d3 = makeDelay(lfoLf3, lfoHf)
    node.connect(d3)

    let panL = system.audio.createStereoPanner()
    nodes.push(panL)
    panL.pan.value = -3/4
    let panR = system.audio.createStereoPanner()
    nodes.push(panR)
    panR.pan.value = 3/4
    d1.connect(panL)
    d2.connect(panL)
    d2.connect(panR)
    d3.connect(panR)

    let mix = system.audio.createGain()
    nodes.push(mix)
    panL.connect(mix)
    panR.connect(mix)
    node.connect(mix)
    mix.gain.value = 1/3

    // This would be a simpler mono chorus but its not as rich sounding as the stereo
    // let mix = system.audio.createGain()
    // d1.connect(mix)
    // d2.connect(mix)
    // d3.connect(mix)
    // mix.gain.value = 1/3

    return mix
  }

  return chorus
})