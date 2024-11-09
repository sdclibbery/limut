'use strict';
define(function(require) {
  let system = require('play/system');

  let audioNodeProto
  let connectOp = (l,r) => {
    if (l === undefined) { return r }
    if (r === undefined) { return l }
    if (!(l instanceof AudioNode)) { throw `>> failed: ${l} is not an AudioNode` }
    if (!(r instanceof AudioNode)) { throw `>> failed: ${r} is not an AudioNode` }
    if (!audioNodeProto) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    let composite = Object.create(audioNodeProto) // Create object that satisfies instancof AudioNode
    composite.l = l
    composite.r = r
    l.connect(r.target ? r.target : r) // r might also be a composite with a target
    composite.target = l.target ? l.target : l // l might also be a composite with a target
    composite.connect = (destination, outputIndex, inputIndex) => {
      return r.connect(destination, outputIndex, inputIndex)
    }
    composite.disconnect = () => {
      l.disconnect()
      r.disconnect()
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
    if (!audioNodeProto) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    let an = Object.create(audioNodeProto)
    an.connect = () => {}
    an.disconnect = () => {}
    return an
  }

  let an = mockAn()
  assert(an, connectOp(an, undefined))
  assert(an, connectOp(undefined, an))

  assertThrows('not an AudioNode', () => connectOp(1,2))

  assert(true, connectOp(mockAn(), mockAn()) instanceof AudioNode)

  console.log("connectOp tests complete")
  }

  return connectOp
})