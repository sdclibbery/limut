'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction
  let system = require('play/system');
  let {evalMainParamEvent,evalMainParamFrame} = require('play/eval-audio-params')
  let setWave = require('play/synth/waveforms/set-wave')
  var metronome = require('metronome')

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
      args.idx = e.idx
      args._destructor = e._destructor
    }
  }

  let audioNodeProto
  addNodeFunction('mockaudionode', (args,e,b) => { // For tests to run without creating an actual AudioNode
    if (audioNodeProto === undefined) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    let an = Object.create(audioNodeProto)
    an.connect = (v) => { an.connected = v }
    an.disconnect = () => { an.disconnected }
    return an
  })

  addNodeFunction('osc', (args,e,b) => {
    let node = system.audio.createOscillator()
    addEventTimingData(args, e)
    setWave(node, evalMainParamEvent(args, 'value', 'sawtooth'))
    evalMainParamFrame(node.frequency, args, 'freq', 440, 'hz')
    node.start(args._time)
    args._destructor.stop(node)
    return node
  })

  addNodeFunction('const', (args,e,b) => {
    let node = system.audio.createConstantSource()
    addEventTimingData(args, e)
    evalMainParamFrame(node.offset, args, 'value', 1)
    node.start(args._time)
    args._destructor.stop(node)
    return node
  })

  addNodeFunction('gain', (args,e,b) => {
    let node = system.audio.createGain()
    addEventTimingData(args, e)
    evalMainParamFrame(node.gain, args, 'value', 1)
    return node
  })

  addNodeFunction('biquad', (args,e,b) => {
    let node = system.audio.createBiquadFilter()
    addEventTimingData(args, e)
    node.type = evalMainParamEvent(args, 'value', 'lowpass')
    evalMainParamFrame(node.frequency, args, 'freq', 1, 'hz')
    evalMainParamFrame(node.Q, args, 'q', 5)
    evalMainParamFrame(node.gain, args, 'gain', 1)
    return node
  })

  addNodeFunction('delay', (args,e,b) => {
    let maxDelay = evalMainParamEvent(args, 'max', 1, 'b') * metronome.beatDuration()
    let node = system.audio.createDelay(maxDelay)
    addEventTimingData(args, e)
    evalMainParamFrame(node.delayTime, args, 'value', 1/4, 'b', d => d * metronome.beatDuration())
    return node
  })

})
  