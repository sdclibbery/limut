'use strict';
define(function (require) {
  let system = require('play/system');

  let getAudioNode = (v, field) => {
    while (v[field]) { v = v[field] } // Go through all composites to get to the actual AudioNode
    return v
  }

  let resolveAudioNodes = (v, field) => {
    if (typeof v !== 'object') { return [] }
    if (v.value === undefined) { return [getAudioNode(v, field)]} // Not an array
    let vs = []
    let idx = 0
    vs[idx] = getAudioNode(v.value, field)
    idx++
    while (v['value'+idx] !== undefined) {
      vs[idx] = getAudioNode(v['value'+idx], field)
      idx++
    }
    return vs
  }

  let connect = (l, r, destructor) => {
    let ls = resolveAudioNodes(l, 'r')
    let rs = resolveAudioNodes(r, 'l')
    ls.forEach(lv => {
      rs.forEach(rv => {
        if (!(lv instanceof AudioNode)) { throw `l ${lv} is not an AudioNode` }
        if (!(rv instanceof AudioNode)) { throw `r ${rv} is not an AudioNode` }
        lv.connect(rv)
        if (destructor) {
          destructor.disconnect(lv)
          destructor.disconnect(rv)
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

  let audioNodeProto
  let mockAn = () => {
    if (audioNodeProto === undefined) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    let an = Object.create(audioNodeProto)
    an.connect = (v) => { an.connected = v }
    an.reset = () => an.connected = undefined
    return an
  }
  let l = mockAn()
  let l2 = mockAn()
  let r = mockAn()

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
    connect: connect,
  }
})
