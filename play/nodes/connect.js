'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalParamEvent} = require('player/eval-param')

  let isNode = v => v instanceof AudioNode
  let isParam = v => v instanceof AudioParam
  let isNodeArray = v => typeof v === 'object' && v.value instanceof AudioNode && !isParam(v)
  let isConnectableOrPlaceholder = v => {
    if (v === 0) { return true } // Placeholder for expand chords
    if (typeof v !== 'object') { return false }
    if (isNode(v)) { return true }
    if (isParam(v)) { return true }
    if (v.value === undefined) { return false }
    if (isConnectableOrPlaceholder(v.value)) { return true }
    let idx = 1
    while (v['value'+idx] !== undefined) { // Have to recursively check array values to see if its connectable
      if (isConnectableOrPlaceholder(v['value'+idx])) { return true }
      idx++
    }
    return false
  }
  let isConnectable = v => {
    if (typeof v !== 'object') { return false }
    if (isNode(v)) { return true }
    if (isParam(v)) { return true }
    if (v.value === undefined) { return false }
    if (isConnectable(v.value)) { return true }
    let idx = 1
    while (v['value'+idx] !== undefined) { // Have to recursively check array values to see if its connectable
      if (isConnectable(v['value'+idx])) { return true }
      idx++
    }
    return false
  }
  
  let resolveAudioNodes = (v, side) => {
    if (typeof v !== 'object') { return v === 0 ? [] : [v] } // Zero is the placeholder for expand-chords
    if (v[side] !== undefined) { return resolveAudioNodes(v[side], side) } // Recurse into components
    if (isNode(v)) { return [v] }
    if (isParam(v)) { return [v] }
    let vs = []
    let idx = 0
    while (v['value'+(idx>0?idx:'')] !== undefined) {
      vs.push(resolveAudioNodes(v['value'+(idx>0?idx:'')], side))
      idx++
    }
    return vs
  }

  let connect = (l, r, destructor, options) => {
    let ls = resolveAudioNodes(l, 'r').flat(999)
    let rs = resolveAudioNodes(r, 'l').flat(999)
    let channel = options && options.channel
    ls.forEach(lv => {
      rs.forEach(rv => {
        if (!(lv instanceof AudioNode) && !(lv instanceof AudioParam)) {
          // console.log(`Connect: lv is not an AudioNode/AudioParam`, lv, ' rv: ', rv, ' lr: ', l, r)
          throw new Error(`Connect: l ${lv} is not an AudioNode/AudioParam`)
        }
        if (!(rv instanceof AudioNode) && !(rv instanceof AudioParam)) {
          // console.log(`Connect: rv is not an AudioNode/AudioParam`, rv, ' lv: ', lv, ' lr: ', l, r)
          throw new Error(`Connect: r ${rv} is not an AudioNode/AudioParam`)
        }
        if (rv.numberOfInputs === 0) { return } // Dont connect to nodes that dont have inputs
        if (rv.passthrough !== undefined) { rv.passthrough(lv) } // Passthrough is for nodes that dont want to create an actual webaudio node
        else {
          if (channel !== undefined) {
            let channelIn = channel
            let channelOut = channel
            if (lv.numberOfOutputs <= channelOut) { channelOut = 0 }
            if (rv.numberOfInputs <= channelIn) { channelIn = 0 }
            lv.connect(rv, channelOut, channelIn)
          } else {
            lv.connect(rv)
          }
        }
        if (destructor) {
          destructor.disconnect(lv)
          if (!options || !options.dont_disconnect_r) {
            if (rv instanceof AudioNode) { destructor.disconnect(rv) }
          }
        }
      })
    })
    return r
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  
  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let assertThrows = async (expected, code) => {
    let got
    try {await code()}
    catch (e) { if (e.message.includes(expected)) {got=true} else {console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: ${e.message}`)} }
    finally { if (!got) console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: none` ) }
  }

  let audioNodeProto
  let mockAn = () => {
    if (audioNodeProto === undefined) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    let an = Object.create(audioNodeProto)
    an.connect = (v) => { an.connected = v }
    an.reset = () => an.connected = undefined
    Object.defineProperty(an, "numberOfInputs", { get() { return 1 } })
    return an
  }
  let l = mockAn()
  let l2 = mockAn()
  let r = mockAn()

  assertThrows('is not an AudioNode', () => connect({value:1},{value:2}))
  assertThrows('is not an AudioNode', () => connect(l,{value:2})); l.reset()

  connect(l,r) // Direct audionodes
  assert(r, l.connected)
  assert(undefined, r.connected)

  let lc = {r:l}; l.reset() // Composites with audionode as target
  let rc = {l:r}; r.reset()
  connect(lc,rc)
  assert(r, l.connected)
  assert(undefined, r.connected)

  let lcc = {r:lc}; l.reset() // Nested composites
  let rcc = {l:rc}; r.reset()
  connect(lcc,rcc)
  assert(r, l.connected)
  assert(undefined, r.connected)

  let para = {value:l,value1:l2} // Array of audionodes for parallel connection
  l.reset(); l2.reset(); r.reset()
  connect(para,r)
  assert(r, l.connected)
  assert(r, l2.connected)
  assert(undefined, r.connected)

  console.log("node-connect tests complete")
  }

  return {
      isNode: isNode,
      isParam: isParam,
      isNodeArray: isNodeArray,
      isConnectable: isConnectable,
      isConnectableOrPlaceholder: isConnectableOrPlaceholder,
      connect: connect,
  }
})
