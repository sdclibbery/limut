'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction
  let system = require('play/system');
  let {evalMainParamEvent,evalMainParamFrame} = require('play/eval-audio-params')
  let {evalParamFrame,evalParamEvent} = require('player/eval-param')
  var metronome = require('metronome')
  let {connect,isConnectable} = require('play/nodes/connect')
  let connectOp = require('expression/connectOp')
  require('play/nodes/convolver')
  require('play/nodes/source')

  let addNodeFunction = (k, v) => {
    v.dontEvalArgs = true
    v._thisVar = true // Do not evaluate node functions during expand-chords; should rename _thisVar really
    addVarFunction(k, v)
  }

  let combineParams = (args, e) => {
    let params = {}
    Object.assign(params, e, args)
    params.__event = e // For eval audio params to access the 'real' event
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
  
  let mockgainnode = (args,e,b) => { // mock of a gain node for testing
    let node = mockaudionode(args,e,b)
    let params = combineParams(args, e)
    node.gain = Object.create(audioParamProto) // Mock AudioParam; add a gain param to the mock node
    Object.defineProperty(node.gain, "value", {
      set(v) { node.gain._value = v },
      get() { return node.gain._value },
    })
    node.gain.value = 1
    node.gain.setValueAtTime = (v)=>node.gain.value=v
    node.gain.setTargetAtTime = (v)=>node.gain.value=v
    node.gain.connected = []
    evalMainParamFrame(node.gain, params, 'value', 1)
    return node
  }
  addNodeFunction('mockgainnode', mockgainnode)
  
  let mockconstnode = (args,e,b) => { // mock of a const node for testing
    let node = mockaudionode(args,e,b)
    let params = combineParams(args, e)
    node.offset = Object.create(audioParamProto) // Mock AudioParam; add a offset param to the mock node
    Object.defineProperty(node.offset, "value", {
      set(v) { node.offset._value = v },
      get() { return node.offset._value },
    })
    node.offset.value = 1
    node.offset.setValueAtTime = (v)=>node.offset.value=v
    node.offset.setTargetAtTime = (v)=>node.offset.value=v
    node.offset.connected = []
    evalMainParamFrame(node.offset, params, 'value', 1)
    return node
  }
  addNodeFunction('mockconstnode', mockconstnode)
  
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

  let shaper = (args,e,b) => {
    let node = system.audio.createWaveShaper()
    let count = evalMainParamEvent(args, 'samples', 257)
    let oversample = evalMainParamEvent(args, 'oversample', '2x')
    let curve = new Float32Array(count)
    args.value.modifiers = args.value.modifiers || {}
    for (let i = 0; i < count; i++) {
      let x = (i/(count-1))*2 - 1
      args.value.modifiers.value = x
      let y = evalParamFrame(args.value,e,b, {doNotMemoise:true}) // It will memoise the same result across all x if allowed to
      curve[i] = y
    }
    node.curve = curve
    node.oversample = oversample
    return node
  }
  addNodeFunction('shaper', shaper)

  let delay = (args,e,b) => {
    let maxDelay = evalMainParamEvent(args, 'max', 1, 'b') * metronome.beatDuration()
    let node = system.audio.createDelay(maxDelay)
    let params = combineParams(args, e)
    evalMainParamFrame(node.delayTime, params, 'value', 1/4, 'b', d => d * metronome.beatDuration())
    e._disconnectTime += maxDelay
    let unevalledFeedback = args['feedback'] || args['value1']
    let feedbackChain = evalParamEvent(unevalledFeedback, e)
    if (feedbackChain !== undefined) {
      if (!isConnectable(feedbackChain)) { feedbackChain = gain({value:unevalledFeedback}, e,b) }
      connect(node, feedbackChain, e._destructor)
      connect(feedbackChain, node, e._destructor)
    }
    return node
  }
  addNodeFunction('delay', delay)

  let panner = (args,e,b) => {
    let node = system.audio.createStereoPanner()
    let params = combineParams(args, e)
    evalMainParamFrame(node.pan, params, 'value', 0)
    return node
  }
  addNodeFunction('panner', panner)

  let compress = (args,e,b) => {
    let node = system.audio.createDynamicsCompressor()
    let params = combineParams(args, e)
    evalMainParamFrame(node.ratio, params, 'ratio', 0, undefined, x => Math.log10(Math.max(x,1e-6))*20) // Convert to dB for webaudio
    evalMainParamFrame(node.threshold, params, 'threshold', -50, undefined, x => Math.log10(Math.max(x,1e-6))*20) // Convert to dB for webaudio
    evalMainParamFrame(node.knee, params, 'knee', 40, undefined, x => Math.log10(Math.max(x,1e-6))*20) // Convert to dB for webaudio
    evalMainParamFrame(node.attack, params, 'attack', 0.01, 's')
    evalMainParamFrame(node.release, params, 'release', 0.25, 's')
    return node
  }
  addNodeFunction('compress', compress) // There is a wrapper in the libs actually called 'compressor'

  let loop = (args,e,b,_,er) => {
    let mainChain = evalParamEvent(args['value'], e)
    let unevalledFeedback = args['feedback'] || args['value1']
    let feedbackChain = evalParamEvent(unevalledFeedback, e)
    if (mainChain === undefined) {
      mainChain = idnode(args,e,b)
      if (feedbackChain === undefined) { return mainChain }
    }
    let mixdownGain = system.audio.createGain()
    e._destructor.disconnect(mixdownGain)
    mainChain = connectOp(mainChain, mixdownGain, e,b,er) // Attach a placeholder gain node to force a mixdown of arrays and prevent idnode loops
    if (feedbackChain === undefined) {
      connect(mainChain, mainChain, e._destructor)
    } else {
      if (!isConnectable(feedbackChain)) { feedbackChain = gain({value:unevalledFeedback}, e,b) }
      connect(mainChain, feedbackChain, e._destructor)
      connect(feedbackChain, mainChain, e._destructor)
    }
    return mainChain
  }
  addNodeFunction('loop', loop)

  let series = (args,e,b,_,er) => {
    let count = evalMainParamEvent(args, 'count', evalMainParamEvent(args, 'value1', 2))
    if (typeof count !== 'number') { throw `series: count ${count} must numeric` }
    if (count < 0) { throw `series: count ${count} must be non-negative` }
    if (count === 0) { return idnode(args,e,b) }
    let node
    for (let i = 0; i<count; i++) {
      let chain = evalParamFrame(args['value'], e,b, {doNotMemoise:true}) // Must get new nodes for every repeat
      if (node === undefined) { node = chain }
      else { node = connectOp(node, chain, e,b,er) }
    }
    return node
  }
  addNodeFunction('series', series)
})
