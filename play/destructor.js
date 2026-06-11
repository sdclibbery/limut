'use strict';
define(function (require) {
  let pool = require('play/node-pool').main

  let makeDestructor = (canPool) => {
    let destructor = {
      canPool: !!canPool, // Only per-event destructors release nodes to the pool; long-lived chains may have inbound edges that outlive them
      nodesToStop: [],
      nodesToDisconnect: [],
      nodesToDisconnectGens: [],
    }
    destructor.stop = (n1, n2, n3, n4, n5, n6, n7, n8) => {
      if (!!n1) { destructor.nodesToStop.push(n1) }
      if (!!n2) { destructor.nodesToStop.push(n2) }
      if (!!n3) { destructor.nodesToStop.push(n3) }
      if (!!n4) { destructor.nodesToStop.push(n4) }
      if (!!n5) { destructor.nodesToStop.push(n5) }
      if (!!n6) { destructor.nodesToStop.push(n6) }
      if (!!n7) { destructor.nodesToStop.push(n7) }
      if (!!n8) { destructor.nodesToStop.push(n8) }
    }
    let reg = (n) => {
      destructor.nodesToDisconnect.push(n)
      destructor.nodesToDisconnectGens.push(n.__gen) // Snapshot generation so destroy can skip nodes that were pooled and reused elsewhere since registration
    }
    destructor.disconnect = (n1, n2, n3, n4, n5, n6, n7, n8) => {
      if (!!n1) { reg(n1) }
      if (!!n2) { reg(n2) }
      if (!!n3) { reg(n3) }
      if (!!n4) { reg(n4) }
      if (!!n5) { reg(n5) }
      if (!!n6) { reg(n6) }
      if (!!n7) { reg(n7) }
      if (!!n8) { reg(n8) }
    }
    destructor.destroy = () => {
      destructor.nodesToStop.forEach(n => { n.stop(); n.disconnect() }) // Disconnect sources too so pooled downstream nodes carry no phantom inbound edges
      destructor.nodesToDisconnect.forEach((n, i) => {
        if (n.__gen !== destructor.nodesToDisconnectGens[i]) { return } // Node was released and reacquired by a newer owner; not ours any more
        n.disconnect()
        if (destructor.canPool) { pool.release(n) }
      })
      destructor.nodesToStop.length = 0
      destructor.nodesToDisconnect.length = 0
      destructor.nodesToDisconnectGens.length = 0
    }
    return destructor
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let fakeNode = () => {
    let n = { stops:0, disconnects:0 }
    n.stop = () => n.stops++
    n.disconnect = () => n.disconnects++
    return n
  }

  let d = makeDestructor()
  assert(false, d.canPool)
  assert(true, makeDestructor(true).canPool)

  let src = fakeNode()
  let proc = fakeNode()
  d.stop(src)
  d.disconnect(proc)
  d.destroy()
  assert(1, src.stops)
  assert(1, src.disconnects) // Stopped sources are also disconnected
  assert(1, proc.disconnects)
  assert(0, d.nodesToStop.length)
  assert(0, d.nodesToDisconnect.length)
  d.destroy() // Second destroy is a no-op
  assert(1, src.stops)
  assert(1, proc.disconnects)

  d = makeDestructor(true)
  let reused = fakeNode()
  reused.__gen = 1
  d.disconnect(reused)
  reused.__gen = 2 // Simulate node being pooled then reacquired by a newer owner
  d.destroy()
  assert(0, reused.disconnects) // Stale generation: destructor must leave it alone

  console.log('Destructor tests complete')
  }

  return makeDestructor
})
