'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction
  let system = require('play/system');
  let {evalMainParamEvent,evalMainParamFrame} = require('play/eval-audio-params')
  let {evalParamFrame,evalParamEvent} = require('player/eval-param')
  let setWave = require('play/synth/waveforms/set-wave')
  var metronome = require('metronome')
  let {connect} = require('play/node-connect')

  let addNodeFunction = (k, v) => {
    v.dontEvalArgs = true
    v._thisVar = true // Do not evaluating node functions during expand-chords; should rename _thisVar really
    addVarFunction(k, v)
  }

  let combineParams = (args, e) => {
    let params = {}
    Object.assign(params, e, args)
    return params
  }

  let audioNodeProto
  let audioParamProto
  let mockaudionode = (args,e,b) => { // For tests to run without creating an actual AudioNode
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
    node.connected = []
    node.connect = (v) => {
      node.connected.push(v)
      if (Array.isArray(v.connected)) { v.connected.push(node) }
    }
    node.disconnect = () => { node.disconnected }
    Object.defineProperty(node, "numberOfInputs", { get() { return 1 } })
    if (!params._destructor) { throw `mockaudionode: No destructor` }
    return node
  }
  addNodeFunction('mockaudionode', mockaudionode)
  
  let idnode = (args,e,b) => { // identity node; passes webaudio connections through without creating an actual node
    if (audioNodeProto === undefined) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    let node = Object.create(audioNodeProto)
    node.ls = []
    node.rs = []
    node.passthrough = (l) => {
      node.ls.push(l)
      node.rs.forEach(r => l.connect(r))
    }
    node.connect = (r) => {
      node.rs.push(r)
      node.ls.forEach(l => l.connect(r))
    }
    node.disconnect = () => {
      delete node.ls
      delete node.rs
    }
    Object.defineProperty(node, "numberOfInputs", { get() { return 1 } })
    return node
  }
  addNodeFunction('idnode', idnode)

  let osc = (args,e,b) => {
    let node = system.audio.createOscillator()
    let params = combineParams(args, e)
    setWave(node, evalMainParamEvent(args, 'value', 'sawtooth'))
    evalMainParamFrame(node.frequency, params, 'freq', 440, 'hz')
    node.start(params._time)
    params._destructor.stop(node)
    return node
  }
  addNodeFunction('osc', osc)

  let constNode = (args,e,b) => {
    let node = system.audio.createConstantSource()
    let params = combineParams(args, e)
    evalMainParamFrame(node.offset, params, 'value', 1)
    node.start(params._time)
    params._destructor.stop(node)
    return node
  }
  addNodeFunction('const', constNode)

  let gain = (args,e,b) => {
    let node = system.audio.createGain()
    let params = combineParams(args, e)
    evalMainParamFrame(node.gain, params, 'value', 1)
    return node
  }
  addNodeFunction('gain', gain)

  let biquad = (args,e,b) => {
    let node = system.audio.createBiquadFilter()
    let params = combineParams(args, e)
    node.type = evalMainParamEvent(args, 'value', 'lowpass')
    evalMainParamFrame(node.frequency, params, 'freq', 440, 'hz')
    evalMainParamFrame(node.Q, params, 'q', 5)
    evalMainParamFrame(node.gain, params, 'gain', undefined, undefined, x => Math.log10(Math.max(x,1e-6))*20) // Convert to dB for WebAudio
    return node
  }
  addNodeFunction('biquad', biquad)

  let delay = (args,e,b) => {
    let maxDelay = evalMainParamEvent(args, 'max', 1, 'b') * metronome.beatDuration()
    let node = system.audio.createDelay(maxDelay)
    let params = combineParams(args, e)
    evalMainParamFrame(node.delayTime, params, 'value', 1/4, 'b', d => d * metronome.beatDuration())
    e._disconnectTime += maxDelay
    let feedback = evalParamEvent(params['feedback'], e)
    if (feedback !== undefined) {
      connect(node, feedback, params._destructor)
      connect(feedback, node, params._destructor)
    }
    return node
  }
  addNodeFunction('delay', delay)

  let shaper = (args,e,b) => {
    let node = system.audio.createWaveShaper()
    let count = evalMainParamEvent(args, 'samples', 257)
    let oversample = evalMainParamEvent(args, 'oversample', '2x')
    let curve = new Float32Array(count)
    args.value.modifiers = args.value.modifiers || {}
    for (let i = 1; i <= count; i++) {
      let x = (i/count)*2 - 1
      args.value.modifiers.value = x
      let y = evalParamFrame(args.value,e,b, {doNotMemoise:true}) // It will memoise the same result across all x if allowed to
      curve[i] = y
    }
    node.curve = curve
    node.oversample = oversample
    return node
  }
  addNodeFunction('shaper', shaper)

})
  