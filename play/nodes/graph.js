'use strict'
define(function(require) {
  let {addNodeFunction,combineParams} = require('play/nodes/node-var')
  let system = require('play/system');
  let {evalMainParamEvent,evalMainParamFrame} = require('play/eval-audio-params')
  let {evalParamFrame,evalParamEvent} = require('player/eval-param')
  let {connect,isConnectable,isConnectableOrPlaceholder} = require('play/nodes/connect')
  let connectOp = require('expression/connectOp')
  require('play/nodes/mocks')
  require('play/nodes/convolver')
  require('play/nodes/source')
  let vars = require('vars')

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
    Object.defineProperty(node, "numberOfInputs", { get() {
      return node.ls.reduce(Math.max, 1)
    } })
    Object.defineProperty(node, "numberOfOutputs", { get() {
      return node.rs.reduce(Math.max, 1)
    } })
    return node
  }
  addNodeFunction('idnode', idnode)
  addNodeFunction('thru', idnode)
  addNodeFunction('dry', idnode)

  let loop = (args,e,b,_,er) => {
    let mainChain = evalParamEvent(args['value'], e)
    if (!isConnectableOrPlaceholder(mainChain)) { mainChain = vars.all().gain({value:args['value']}, e,b) }
    let unevalledFeedback = args['feedback'] || args['value1']
    let feedbackChain = evalParamEvent(unevalledFeedback, e)
    if (!isConnectableOrPlaceholder(feedbackChain)) { feedbackChain = vars.all().gain({value:unevalledFeedback}, e,b) }
    if (mainChain === undefined) {
      mainChain = idnode(args,e,b)
      if (feedbackChain === undefined) { return mainChain }
    }
    let mixdownGain = system.audio.createGain()
    e._destructor.disconnect(mixdownGain)
    mainChain = connectOp(mainChain, mixdownGain, e,b,er, true) // Attach a placeholder gain node to force a mixdown of arrays and prevent idnode loops
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
      else { node = connectOp(node, chain, e,b,er, true) }
    }
    return node
  }
  addNodeFunction('series', series)

  let mix = (args,e,b,_,er) => {
    let params = combineParams(args, e)
    let wetChain = evalParamEvent(params.value, e)
    if (wetChain === undefined) { return idnode(params,e,b) }
    if (!isConnectableOrPlaceholder(wetChain)) { wetChain = vars.all().gain({value:params.value}, e,b) }
    let mixParam = params.mix !== undefined ? 'mix' : 'value1'
    let mixValue = evalParamFrame(params[mixParam], e,e.count, {withInterval:true})
    let interval
    if (typeof mixValue === 'object' && mixValue.interval !== undefined && !isConnectable(mixValue)) {
      interval = mixValue.interval
      mixValue = mixValue.value
    }
    if (interval === undefined && mixValue <= 0.0001) { // dry only
      return idnode(params,e,b)
    }
    if (interval === undefined && mixValue >= 0.9999) { // wet only
      return wetChain
    }
    // Actual mix, equivalent to:  { gain{cos{mix*pi/2}}, wet>>gain{sin{mix*pi/2}} }
    let dryGain = system.audio.createGain()
    let wetGain = system.audio.createGain()
    evalMainParamFrame(dryGain.gain, params, mixParam, 1/2, undefined, mix => Math.cos(mix * Math.PI/2))
    evalMainParamFrame(wetGain.gain, params, mixParam, 1/2, undefined, mix => Math.sin(mix * Math.PI/2))
    return { // Add
      value: dryGain, // Dry part
      value1: connectOp(wetChain, wetGain, e,b,er, true) // Wet part
    }
  }
  addNodeFunction('mix', mix)

  let stereo = (args,e,b,_,er) => {
    let params = combineParams(args, e)
    let lChainParam = 'l'
    let lChain = evalParamEvent(params.l, e)
    if (lChain === undefined) { lChain = evalParamEvent(params.value, e); lChainParam = 'value' }
    if (!isConnectable(lChain)) {
      lChain = system.audio.createGain()
      if (lChain !== undefined) { evalMainParamFrame(lChain.gain, params, lChainParam, 1) }
    }
    let rChainParam = 'r'
    let rChain = evalParamEvent(params.r, e)
    if (rChain === undefined) { rChain = evalParamEvent(params.value1, e); rChainParam = 'value1' }
    if (rChain === undefined) { rChain = evalParamEvent(params.value, e); rChainParam = 'value' }
    if (!isConnectable(rChain)) {
      rChain = system.audio.createGain()
      if (rChain !== undefined) { evalMainParamFrame(rChain.gain, params, rChainParam, 1) }
    }
    // splitter >> l/r chains >> merger
    let splitter = system.audio.createChannelSplitter(2)
    let merger = system.audio.createChannelMerger(2)
    connect(connect(splitter, lChain, e._destructor, {channel:0}), merger, e._destructor, {channel:0})
    connect(connect(splitter, rChain, e._destructor, {channel:1}), merger, e._destructor, {channel:1})
    // Make and return a composite with splitter as l and merger as r
    if (audioNodeProto === undefined) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    let composite = Object.create(audioNodeProto)
    composite.l = splitter
    composite.r = merger
    composite.destructor = e._destructor
    composite.connect = (destination) => {
      return connect(composite.r, destination, e._destructor)
    }
    return composite
  }
  addNodeFunction('stereo', stereo)
})
