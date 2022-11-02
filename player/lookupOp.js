'use strict';
define(function(require) {
  let players = require('player/players')

  let lookupOp = (l,r, event,b,evalRecurse) => {
    if (l === undefined) { return undefined }
    if (r === undefined) { return l }
    if (Array.isArray(l)) {
      return l[Math.floor(r % l.length)] // Chord index
    }
    if (typeof l === 'object') {
      return l[r] // Map lookup
    }
    if (typeof l === 'string') {
      let player = players.instances[l]
      if (player) { // lookup a param on player events
        let originalB = evalRecurse((e,originalB) => originalB, event, b)
        let es = player.currentEvent(originalB)
        let v = es.map(e => e[r])
        if (v.length === 0) { v = 0 }
        if (v.length === 1) { v = v[0] }
        return v
      }
    }
    return l // fallback: just return the LHS value
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }

    assert(undefined, lookupOp())
    assert(1, lookupOp(1, undefined))
    assert(undefined, lookupOp(undefined, 1))
    assert(2, lookupOp([1,2], 1))
    assert(2, lookupOp([1,2], 1.5))
    assert(1, lookupOp([1,2], 2))
    assert([2,3], lookupOp([1,[2,3]], 1))
    assert(1, lookupOp({v:1}, 'v'))
    assert({b:1}, lookupOp({a:{b:1}}, 'a'))
    assert(1, lookupOp(lookupOp({a:{b:1}}, 'a'), 'b'))

    players.instances.p1 = { currentEvent:(b)=>{ return []} }
    assert(0, lookupOp('p1', 'foo', {},0,(v)=>v()))
    delete players.instances.p1
  
    players.instances.p1 = { currentEvent:(b)=>{ return [{foo:b}]} }
    assert(0, lookupOp('p1', 'foo', {},0,(v)=>0))
    assert(2, lookupOp('p1', 'foo', {},2,(v)=>2))
    delete players.instances.p1
  
    players.instances.p1 = { currentEvent:(b)=>{ return [{foo:b},{foo:b}]} }
    assert([0,0], lookupOp('p1', 'foo', {},0,(v)=>0))
    assert([2,2], lookupOp('p1', 'foo', {},2,(v)=>2))
    delete players.instances.p1
  
    console.log('lookupOp tests complete')
  }
  return lookupOp
})