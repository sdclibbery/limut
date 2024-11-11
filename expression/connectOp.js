'use strict';
define(function(require) {
  let system = require('play/system');

  let audioNodeProto
  let getAudioNodeProto = () => {
    if (audioNodeProto === undefined) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    return audioNodeProto
  }

  let connectOp = (l,r) => {
    if (l === undefined) { return r }
    if (r === undefined) { return l }
    if (!(l instanceof AudioNode)) { throw `>> failed: ${l} is not an AudioNode` }
    if (!(r instanceof AudioNode)) { throw `>> failed: ${r} is not an AudioNode` }
    let composite = Object.create(getAudioNodeProto()) // Create object that satisfies instancof AudioNode
    composite.l = l
    composite.r = r
    l.connect(r.target ? r.target : r) // r might also be a composite with a target
    composite.target = l.target ? l.target : l // l might also be a composite with a target
    composite.connect = (destination, outputIndex, inputIndex) => {
      return r.connect(destination, outputIndex, inputIndex)
    }
    composite.disconnect = () => {
      l.disconnect()
      if (l.target) { l.target.disconnect() }
      r.disconnect()
      if (r.target) { r.target.disconnect() }
    }
    return composite
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
    catch (e) { if (e.includes(expected)) {got=true} else {console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: ${e}`)} }
    finally { if (!got) console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: none` ) }
  }
  let mockAn = () => {
    let an = Object.create(getAudioNodeProto())
    an.connect = () => {}
    an.disconnect = () => { an.disconnected = true }
    return an
  }
  let l, r
  let an
  
  an = mockAn()
  assert(an, connectOp(an, undefined))
  assert(an, connectOp(undefined, an))

  assertThrows('not an AudioNode', () => connectOp(1,2))

  l = mockAn()
  r = mockAn()
  an = connectOp(l, r)
  assert(true, an instanceof AudioNode)
  an.disconnect()
  assert(true, l.disconnected)
  assert(true, r.disconnected)

  console.log("connectOp tests complete")
  }

  return connectOp
})