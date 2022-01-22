'use strict';
define(function (require) {
  let system = require('play/system')

  let flanger = (lfoFreq, node, nodes, oscs) => {
    if (lfoFreq == 0) { return node }

    let lfo = system.audio.createOscillator()
    nodes.push(lfo)
    oscs.push(lfo)
    lfo.frequency.value = lfoFreq
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
    nodes.push(bias)
    oscs.push(bias)
    bias.start()
    bias.offset.value = offset

    let lfoGain = system.audio.createGain()
    nodes.push(lfoGain)
    lfo.connect(lfoGain)
    bias.connect(lfoGain)
    lfoGain.gain.value = gain

    let delay = system.audio.createDelay(maxDelay*1.25)
    nodes.push(delay)
    lfoGain.connect(delay.delayTime)
    node.connect(delay)

    let output = system.audio.createGain()

    // Cant really have feedback because webaudio cannot process less than 128 samples (~3ms) worth of delay in a cycle
    // So bung more delays in to give a bit of the feedback effect
    let delay2 = system.audio.createDelay(maxDelay*1.25)
    nodes.push(delay2)
    lfoGain.connect(delay2.delayTime)
    delay.connect(delay2)

    let delay3 = system.audio.createDelay(maxDelay*1.25)
    nodes.push(delay3)
    lfoGain.connect(delay3.delayTime)
    delay2.connect(delay3)

    nodes.push(output)
    node.connect(output)
    delay.connect(output)
    delay2.connect(output)
    // delay3.connect(output)
    output.gain.value = 0.667//5
    return output
  }

  return flanger
})
