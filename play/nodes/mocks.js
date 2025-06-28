'use strict'
define(function(require) {
  let {addNodeFunction,combineParams} = require('play/nodes/node-var')
  let system = require('play/system')
  let {evalMainParamFrame} = require('play/eval-audio-params')

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
    node.test.target_value = 0
    node.test.setValueAtTime = (v)=>node.test.value=v
    node.test.setTargetAtTime = (v)=>node.test.value=v
    node.test.linearRampToValueAtTime = (v)=>node.test.target_value=v
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
})