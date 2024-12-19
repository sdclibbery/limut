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

  let combineParams = (args, e) => {
    let params = {}
    Object.assign(params, e, args)
    return params
  }

  let audioNodeProto
  let audioParamProto
  addNodeFunction('mockaudionode', (args,e,b) => { // For tests to run without creating an actual AudioNode
    if (audioNodeProto === undefined) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    if (audioParamProto === undefined) { audioParamProto = Object.getPrototypeOf(system.audio.createGain().gain) }
    let node = Object.create(audioNodeProto)
    let params = combineParams(args, e)
    node.test = Object.create(audioParamProto) // Mock AudioParam
    Object.defineProperty(node.test, "value", {
      set(v) { node.test._value = v },
      get() { return node.test._value },
    })
    node.test.value = 0
    node.test.setValueAtTime = (v)=>node.test.value=v
    node.test.setTargetAtTime = (v)=>node.test.value=v
    node.test.connected = []
    evalMainParamFrame(node.test, params, 'test', 440, 'hz')
    node.connect = (v) => {
      node.connected = v
      if (Array.isArray(v.connected)) { v.connected.push(node) }
    }
    node.disconnect = () => { node.disconnected }
    return node
  })

  addNodeFunction('osc', (args,e,b) => {
    let node = system.audio.createOscillator()
    let params = combineParams(args, e)
    setWave(node, evalMainParamEvent(args, 'value', 'sawtooth'))
    evalMainParamFrame(node.frequency, params, 'freq', 440, 'hz')
    node.start(params._time)
    params._destructor.stop(node)
    return node
  })

  addNodeFunction('const', (args,e,b) => {
    let node = system.audio.createConstantSource()
    let params = combineParams(args, e)
    evalMainParamFrame(node.offset, params, 'value', 1)
    node.start(params._time)
    params._destructor.stop(node)
    return node
  })

  addNodeFunction('gain', (args,e,b) => {
    let node = system.audio.createGain()
    let params = combineParams(args, e)
    evalMainParamFrame(node.gain, params, 'value', 1)
    return node
  })

  addNodeFunction('biquad', (args,e,b) => {
    let node = system.audio.createBiquadFilter()
    let params = combineParams(args, e)
    node.type = evalMainParamEvent(args, 'value', 'lowpass')
    evalMainParamFrame(node.frequency, params, 'freq', 440, 'hz')
    evalMainParamFrame(node.Q, params, 'q', 5)
    evalMainParamFrame(node.gain, params, 'gain', 1)
    return node
  })

  addNodeFunction('delay', (args,e,b) => {
    let maxDelay = evalMainParamEvent(args, 'max', 1, 'b') * metronome.beatDuration()
    let node = system.audio.createDelay(maxDelay)
    let params = combineParams(args, e)
    evalMainParamFrame(node.delayTime, params, 'value', 1/4, 'b', d => d * metronome.beatDuration())
    e._disconnectTime += maxDelay
    return node
  })

})
  