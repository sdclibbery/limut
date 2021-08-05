'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalPerEvent} = require('play/eval-audio-params')
  let freeverb = require('play/effects/freeverb')
  let phaser = require('play/effects/phaser')
  let chorus = require('play/effects/chorus')

  let echo = (params, node) => {
    let echoDelay = evalPerEvent(params, 'echo', 0) * params.beat.duration
    if (!echoDelay || echoDelay < 0.0001) { return node }
    let echoFeedback = Math.min(evalPerEvent(params, 'echofeedback', 0.5), 0.95)
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

  let reverb = (params, node) => {
    let room = evalPerEvent(params, 'room', 0)*0.7
    if (!room || room < 0.01) { return node }
    let fv = freeverb(room)
    node.connect(fv)
    let mix = system.audio.createGain()
    node.connect(mix)
    fv.connect(mix)
    return mix
  }

  return (params, node) => {
    node = chorus(params, node)
    node = phaser(params, node)
    node = echo(params, node)
    node = reverb(params, node)
    return node
  }
})
