'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalMainParamFrame} = require('play/eval-audio-params')
  let {mix} = require('play/effects/mix')
  let {mainParam} = require('player/sub-param')

  // Inspired by https://www.soundonsound.com/techniques/more-creative-synthesis-delays

  let chorus = (destructor, params, chorusAmount, node) => {
    let lfoLf1, lfoLf2, lfoLf3
    let lfoHfSrc, lfoHf
    let bias
    const lfoHfGain = 0.12
  
    const lfFreq = 0.62165132
    lfoLf1 = system.audio.createOscillator()
    destructor.disconnect(lfoLf1)
    destructor.stop(lfoLf1)
    lfoLf1.frequency.value = lfFreq
    lfoLf1.start(system.audio.currentTime)

    lfoLf2 = system.audio.createOscillator()
    destructor.disconnect(lfoLf2)
    destructor.stop(lfoLf2)
    lfoLf2.frequency.value = lfFreq
    lfoLf2.start(system.audio.currentTime+0.333/lfFreq)

    lfoLf3 = system.audio.createOscillator()
    destructor.disconnect(lfoLf3)
    destructor.stop(lfoLf3)
    lfoLf3.frequency.value = lfFreq
    lfoLf3.start(system.audio.currentTime+0.667/lfFreq)

    lfoHfSrc = system.audio.createOscillator()
    destructor.disconnect(lfoHfSrc)
    destructor.stop(lfoHfSrc)
    lfoHfSrc.frequency.value = 6.674325
    lfoHfSrc.start(system.audio.currentTime)
    lfoHf = system.audio.createGain()
    destructor.disconnect(lfoHf)
    lfoHf.gain.value = lfoHfGain
    lfoHfSrc.connect(lfoHf)

    bias = system.audio.createConstantSource()
    destructor.disconnect(bias)
    destructor.stop(bias)
    bias.start()
    bias.offset.value = 1.1

    let makeDelay = (lfo1, lfo2) => {
      let lfoGain = system.audio.createGain()
      destructor.disconnect(lfoGain)
      lfo1.connect(lfoGain)
      lfo2.connect(lfoGain)
      bias.connect(lfoGain)
  
      const maxDelay = 40/1000
      const lfoNormalise = 2*(1 + bias.offset.value + lfoHfGain)
      if (!!params) {
        evalMainParamFrame(lfoGain.gain, params, 'chorus', 1, c => (c/8)*maxDelay/lfoNormalise)
      } else {
        lfoGain.gain.value = (chorusAmount/8)*maxDelay/lfoNormalise
      }
  
      let delay = system.audio.createDelay(maxDelay*1.25)
      destructor.disconnect(delay)
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
    destructor.disconnect(panL)
    panL.pan.value = -3/4
    let panR = system.audio.createStereoPanner()
    destructor.disconnect(panR)
    panR.pan.value = 3/4
    d1.connect(panL)
    d2.connect(panL)
    d2.connect(panR)
    d3.connect(panR)

    let output = system.audio.createGain()
    destructor.disconnect(output)
    panL.connect(output)
    panR.connect(output)
    output.gain.value = 3/4

    // This would be a simpler mono chorus but its not as rich sounding as the stereo
    // let output = system.audio.createGain()
    // d1.connect(output)
    // d2.connect(output)
    // d3.connect(output)
    // output.gain.value = 1/3

    return output
  }

  let fixedChorus = (destructor, chorusAmount, node) => {
    if (!chorusAmount) { return node }
    return chorus(destructor, undefined, chorusAmount, node)
  }

  let mixedChorus = (params, node) => {
    if (!mainParam(params.chorus, 0)) { return node }
    let chorusNode = chorus(params._destructor, params, undefined, node)
    return mix(params, 'chorus', node, chorusNode, 1)
  }

  return {
    fixedChorus: fixedChorus,
    mixedChorus: mixedChorus,
  }
})