'use strict';
define(function (require) {
  let system = require('play/system');

  let getTarget = (v) => {
    while (v.target) { v = v.target }
    return v
  }

  let connect = (l, r, destructor) => {
    getTarget(l).connect(getTarget(r))
    if (destructor) {
      destructor.disconnect(getTarget(l))
      destructor.disconnect(getTarget(r))
    }
    return r
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  
  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  let audioNodeProto
  let mockAn = () => {
    if (audioNodeProto === undefined) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    let an = Object.create(audioNodeProto)
    an.connect = (v) => { an.connected = v }
    an.reset = () => an.connected = undefined
    return an
  }
  let l = mockAn()
  let r = mockAn()

  connect(l,r)
  assert(r, l.connected)

  let lc = {target:l}; l.reset()
  let rc = {target:r}; r.reset()
  connect(lc,rc)
  assert(r, l.connected)

  let lcc = {target:lc}; l.reset()
  let rcc = {target:rc}; r.reset()
  connect(lcc,rcc)
  assert(r, l.connected)

  console.log("node-connect tests complete")
  }

  return {
    connect: connect,
  }
})
