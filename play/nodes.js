'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction
  let system = require('play/system');
  let {evalParamEvent} = require('player/eval-param')
  let {evalMainParamFrame} = require('play/eval-audio-params')

  let addNodeFunction = (k, v) => {
    v.dontEvalArgs = true
    addVarFunction(k, v)
  }

  let addEventTimingData = (args, e) => {
    if (args.count === undefined) {
      args.count = e.count
      args.beat = e.beat
      args._time = e._time
      args.endTime = e.endTime
      args.dur = e.dur
    }
  }

  addNodeFunction('gain', (args,e,b) => {
    let node = system.audio.createGain()
    addEventTimingData(args, e)
    evalMainParamFrame(node.gain, args, 'value', 1)
    return node
  })

  addNodeFunction('biquad', (args,e,b) => {
    let node = system.audio.createBiquadFilter()
    addEventTimingData(args, e)
    node.type = evalParamEvent(args.value, e) || 'lowpass'
    evalMainParamFrame(node.frequency, args, 'freq', 1, 'hz')
    evalMainParamFrame(node.Q, args, 'q', 5)
    evalMainParamFrame(node.gain, args, 'gain', 1)
    return node
  })

})
  