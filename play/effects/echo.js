'use strict'
define((require) => {
  var system = require('play/system')
  var metronome = require('metronome')
  let {mainParam} = require('player/sub-param')
  let {evalMainParamFrame,evalSubParamFrame,evalMainParamEvent,evalSubParamEvent} = require('play/eval-audio-params')

  let echo = (params, node) => {
    if (!mainParam(params.echo, 0)) { return node }
    let initialDelay = evalMainParamEvent(params, 'echo', 0) * metronome.beatDuration()
    let maxDelay = evalSubParamEvent(params, 'echo', 'max', Math.max(1,initialDelay)) * metronome.beatDuration()
    let echo = system.audio.createDelay(maxDelay)
    evalMainParamFrame(echo.delayTime, params, 'echo', 0, d => d * metronome.beatDuration())
    let echoGain = system.audio.createGain()
    evalSubParamFrame(echoGain.gain, params, 'echo', 'feedback', 0.35)
    node.connect(echo)
    echo.connect(echoGain)
    echoGain.connect(echo)
    let mix = system.audio.createGain()
    node.connect(mix)
    echoGain.connect(mix)
    params._destroyWait += maxDelay*10
    params._destructor.disconnect(echo, echoGain, mix)
    return mix
  }

  let fixedEcho = (destructor, echoDelay, echoFeedback, node) => {
    if (!echoDelay || echoDelay < 0.0001) { return node }
    let echo = system.audio.createDelay(echoDelay)
    destructor.disconnect(echo)
    echo.delayTime.value = echoDelay
    let echoGain = system.audio.createGain()
    destructor.disconnect(echoGain)
    echoGain.gain.value = echoFeedback
    echo.connect(echoGain)
    echoGain.connect(echo)
    node.connect(echo)
    let mix = system.audio.createGain()
    destructor.disconnect(mix)
    node.connect(mix)
    echoGain.connect(mix)
    return mix
  }

  return {
    echo: echo,
    fixedEcho: fixedEcho,
  }
})