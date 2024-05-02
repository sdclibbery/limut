'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalMainParamFrame} = require('play/eval-audio-params')
  let {mix} = require('play/effects/mix')
  let {mainParam} = require('player/sub-param')

  let flanger = (destructor, params, lfoFreq, node) => {
    let lfo = system.audio.createOscillator()
    destructor.disconnect(lfo)
    destructor.stop(lfo)
    if (!!params) {
      evalMainParamFrame(lfo.frequency, params, 'flanger', 1, 'cpb')
    } else {
      lfo.frequency.value = lfoFreq
    }
    lfo.start(system.audio.currentTime)

    const minDelay = 0.1/1000
    const maxDelay = 5/1000
    const gain = (maxDelay-minDelay)/2
    const offset = (minDelay+maxDelay)/(2*gain)
    // outMin = (bias-lfo)*lfoGain = minDelay
    // outMax = (bias+lfo)*lfoGain = maxDelay
    // bias-1 = minDelay/lfoGain
    // bias+1 = maxDelay/lfoGain
    // 2 = (maxDelay-minDelay)/lfoGain
    // lfoGain = (maxDelay-minDelay)/2
    // bias = (minDelay+maxDelay)/(2*lfoGain)

    let bias = system.audio.createConstantSource()
    destructor.disconnect(bias)
    destructor.stop(bias)
    bias.start()
    bias.offset.value = offset

    let lfoGain = system.audio.createGain()
    destructor.disconnect(lfoGain)
    lfo.connect(lfoGain)
    bias.connect(lfoGain)
    lfoGain.gain.value = gain

    let delay = system.audio.createDelay(maxDelay*1.25)
    destructor.disconnect(delay)
    lfoGain.connect(delay.delayTime)
    node.connect(delay)

    let output = system.audio.createGain()

    // Cant really have feedback because webaudio cannot process less than 128 samples (~3ms) worth of delay in a cycle
    // So bung more delays in to give a bit of the feedback effect
    let delay2 = system.audio.createDelay(maxDelay*1.25)
    destructor.disconnect(delay2)
    lfoGain.connect(delay2.delayTime)
    delay.connect(delay2)

    destructor.disconnect(output)
    node.connect(output)
    delay.connect(output)
    delay2.connect(output)
    output.gain.value = 0.667//5
    return output
  }

  let fixedFlanger = (destructor, lfoFreq, node) => {
    if (lfoFreq == 0) { return node }
    return flanger(destructor, undefined, lfoFreq, node)
  }

  let mixedFlanger = (params, node) => {
    if (!mainParam(params.flanger, 0)) { return node }
    let flangerNode = flanger(params._destructor, params, undefined, node)
    return mix(params, 'flanger', node, flangerNode, 1)
  }

  return {
    fixedFlanger: fixedFlanger,
    mixedFlanger: mixedFlanger,
  }
})
