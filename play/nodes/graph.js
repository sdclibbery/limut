'use strict'
define(function(require) {
  let {addNodeFunction} = require('play/nodes/node-var')
  let system = require('play/system');
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let {evalParamFrame,evalParamEvent} = require('player/eval-param')
  let {connect,isConnectable} = require('play/nodes/connect')
  let connectOp = require('expression/connectOp')
  require('play/nodes/mocks')
  require('play/nodes/convolver')
  require('play/nodes/source')

  let audioNodeProto
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
  addNodeFunction('thru', idnode)
  addNodeFunction('dry', idnode)

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
