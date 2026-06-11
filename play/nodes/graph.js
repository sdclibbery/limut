'use strict'
define(function(require) {
  let {addNodeFunction,combineParams} = require('play/nodes/node-var')
  let system = require('play/system');
  let {evalMainParamEvent,evalMainParamFrame} = require('play/eval-audio-params')
  let {evalParamFrame,evalParamEvent} = require('player/eval-param')
  let {connect,isConnectable} = require('play/nodes/connect')
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
    if (!isConnectable(mainChain)) { mainChain = vars.all().gain({value:args['value']}, e,b) }
    let unevalledFeedback = args['feedback'] || args['value1']
    let feedbackChain = evalParamEvent(unevalledFeedback, e)
    if (!isConnectable(feedbackChain)) { feedbackChain = vars.all().gain({value:unevalledFeedback}, e,b) }
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

  // series{chain, count} : repeat the chain count times in series. The chain may be a
  // user defined function given the repeat index (eg {i}->lpf{600*(i+1)}) so each
  // repeat can differ.
  let series = (args,e,b,_,er) => {
    let count = evalMainParamEvent(args, 'count', evalMainParamEvent(args, 'value1', 2))
    if (typeof count !== 'number') { throw `series: count ${count} must numeric` }
    if (count < 0) { throw `series: count ${count} must be non-negative` }
    if (count === 0) { return idnode(args,e,b) }
    let callback = args['value']
    let isLambda = typeof callback === 'function' && callback.isUserFunction
    let node
    for (let i = 0; i<count; i++) {
      let chain
      if (isLambda) {
        let ev = Object.create(Object.getPrototypeOf(e), Object.getOwnPropertyDescriptors(e)) // Distinct event so per-function memoisation doesn't collapse every repeat to repeat 0; clone descriptors so non-enumerable getters from the fx-chain event survive
        chain = callback(ev, b, evalParamFrame, {value:i})
        if (!isConnectable(chain)) {
          // The body evaluated to an amplitude, not a node chain. Hand the lambda itself to
          // gain as its value param (reusing the per-repeat ev so memoisation stays isolated)
          // so a frame-varying body gets per-frame updates - same pattern as parallel below
          let repeatGain = (e2,b2,er2) => callback(ev, b2, er2, {value:i})
          chain = vars.all().gain({value:repeatGain}, e,b)
        }
      } else {
        chain = evalParamFrame(callback, e,b, {doNotMemoise:true}) // Must get new nodes for every repeat
      }
      if (node === undefined) { node = chain }
      else { node = connectOp(node, chain, e,b,er) }
    }
    return node
  }
  addNodeFunction('series', series)

  // parallel{{i}->chain, count} : run the chain count times in parallel (default 2):
  // connect() fans the input out to every copy and sums the copies' outputs back
  // together. The chain may be a user defined function given the copy index
  // (eg {i}->lpf{600*(i+1)}) so each copy can differ.
  let parallel = (args,e,b,_,er) => {
    let count = Math.floor(evalMainParamEvent(args, 'count', evalMainParamEvent(args, 'value1', 2)))
    if (typeof count !== 'number' || isNaN(count)) { throw `parallel: count must be numeric` }
    if (count < 1) { return idnode(args,e,b) }
    let callback = args['value'] || args['chain']
    let isLambda = typeof callback === 'function' && callback.isUserFunction
    let result = {}
    for (let i = 0; i < count; i++) {
      let proc
      if (isLambda) {
        let ev = Object.create(Object.getPrototypeOf(e), Object.getOwnPropertyDescriptors(e)) // Distinct event so per-function memoisation doesn't collapse every copy to copy 0; clone descriptors so non-enumerable getters from the fx-chain event survive
        proc = callback(ev, b, evalParamFrame, {value:i})
        if (!isConnectable(proc)) {
          // The body evaluated to an amplitude, not a node chain. Hand the lambda itself to
          // gain as its value param (reusing the per-copy ev so memoisation stays isolated)
          // so a frame-varying body gets per-frame updates - same pattern as series above
          let copyGain = (e2,b2,er2) => callback(ev, b2, er2, {value:i})
          proc = vars.all().gain({value:copyGain}, e,b)
        }
      } else if (callback !== undefined) {
        proc = evalParamFrame(callback, e,b, {doNotMemoise:true}) // Must get new nodes for every copy
      }
      if (!isConnectable(proc)) {
        proc = (proc === undefined) ? idnode(args,e,b) : vars.all().gain({value:proc}, e,b)
      }
      result[i===0 ? 'value' : 'value'+i] = proc
    }
    return result
  }
  addNodeFunction('parallel', parallel)

  let mix = (args,e,b,_,er) => {
    let params = combineParams(args, e)
    let wetChain = evalParamEvent(params.value, e)
    if (wetChain === undefined) { return idnode(params,e,b) }
    if (!isConnectable(wetChain)) { wetChain = vars.all().gain({value:params.value}, e,b) }
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
      value1: connectOp(wetChain, wetGain, e,b,er) // Wet part
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

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let er = (v) => v // passthrough evalRecurse: operands here are already real nodes

  // series: a user defined function chain is invoked once per repeat with the repeat index
  let sCalls = []
  let sCb = (e,b,erFn,a) => { sCalls.push(a.value); return system.audio.createGain() }
  sCb.isUserFunction = true
  let sRes = series({value:sCb, value1:3}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert([0,1,2], sCalls) // repeat indices passed in order
  assert(true, isConnectable(sRes))

  // series: each repeat gets a distinct event so memoisation can't collapse repeats together
  let sEvents = []
  let sCb2 = (e,b,erFn,a) => { sEvents.push(e); return system.audio.createGain() }
  sCb2.isUserFunction = true
  series({value:sCb2, value1:2}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert(true, sEvents[0] !== sEvents[1])

  // parallel: a user defined function chain is invoked once per copy with the copy index,
  // and the result is a {value,value1,...} map that connect() treats as parallel.
  let pCalls = []
  let pCb = (e,b,erFn,a) => { pCalls.push(a.value); return system.audio.createGain() }
  pCb.isUserFunction = true
  let pRes = parallel({value:pCb, value1:3}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert([0,1,2], pCalls) // copy indices passed in order
  assert(true, isConnectable(pRes))
  assert(true, pRes.value !== undefined && pRes.value1 !== undefined && pRes.value2 !== undefined && pRes.value3 === undefined)

  // parallel: each copy gets a distinct event so memoisation can't collapse copies together
  let pEvents = []
  let pCb2 = (e,b,erFn,a) => { pEvents.push(e); return system.audio.createGain() }
  pCb2.isUserFunction = true
  parallel({value:pCb2, value1:2}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert(true, pEvents[0] !== pEvents[1])

  // parallel: count defaults to 2; no callback gives passthrough identity copies
  let pRes2 = parallel({}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert(true, isConnectable(pRes2))
  assert(true, pRes2.value !== undefined && pRes2.value1 !== undefined && pRes2.value2 === undefined)

  // parallel: count of zero gives a single passthrough
  let pRes3 = parallel({value1:0}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert(true, isConnectable(pRes3))
  assert(true, pRes3.value === undefined) // idnode, not a parallel map

  console.log('Graph tests complete')
  }
})
