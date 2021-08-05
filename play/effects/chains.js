'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalPerEvent} = require('play/eval-audio-params')
  let freeverb = require('play/effects/freeverb')
  let phaser = require('play/effects/phaser')
  let chorus = require('play/effects/chorus')

  let echo = (echoDelay, echoFeedback, node) => {
    if (!echoDelay || echoDelay < 0.0001) { return node }
    let echo = system.audio.createDelay(echoDelay)
    echo.delayTime.value = echoDelay
    let echoGain = system.audio.createGain()
    echoGain.gain.value = echoFeedback
    echo.connect(echoGain)
    echoGain.connect(echo)
    node.connect(echo)
    let mix = system.audio.createGain()
    node.connect(mix)
    echoGain.connect(mix)
    return mix
  }

  let reverb = (room, node) => {
    if (!room || room < 0.01) { return node }
    let fv = freeverb(room)
    node.connect(fv)
    let mix = system.audio.createGain()
    node.connect(mix)
    fv.connect(mix)
    return mix
  }

  let quantise = (v, step) =>{
    return (Math.round(v*step)/step)
  }

  return (params, node) => {
    let chainParams = {
      chorusAmount: quantise(evalPerEvent(params, 'chorus', 0), 8),
      lfoFreq: quantise(evalPerEvent(params, 'phaser', 0) / params.beat.duration, 16),
      echoDelay: quantise(evalPerEvent(params, 'echo', 0) * params.beat.duration, 16),
      echoFeedback: quantise(Math.min(evalPerEvent(params, 'echofeedback', 0.5), 0.95), 20),
      room: quantise(evalPerEvent(params, 'room', 0)*0.7, 16),
    }
    node = chorus(chainParams.chorusAmount, node)
    node = phaser(chainParams.lfoFreq, node)
    node = echo(chainParams.echoDelay, chainParams.echoFeedback, node)
    node = reverb(chainParams.room, node)
    return node
  }
})
