'use strict';
define(function(require) {
  let players = require('player/players')
  let {mainParam} = require('player/sub-param')
  let {evalParamFrame,evalFunctionWithModifiers} = require('player/eval-param')
  let {addVarFunction,remove} = require('predefined-vars')

  let lookupOp = (l,r, event,b,evalRecurse) => {
    if (l === undefined) { return undefined }
    if (r === undefined) { return l }
    l = evalRecurse(l, event,b)
    let ml = mainParam(l)
    if (typeof r === 'function') {
      r.args = l
      let v = evalFunctionWithModifiers(r,event,b, evalRecurse)
      if (typeof v === 'object' && v._finalResult) { return v.value } // This is the final result (eg aggregator), no further lookup needed
      r = v
    }
    r = evalRecurse(r, event,b)
    if (Array.isArray(r)) {
      return r.map(rv => lookupOp(l, rv, event,b,evalRecurse)) // If RHS is a chord, map the lookup of each element
    }
    let mr = mainParam(r)
    if (Array.isArray(l)) {
      if (typeof mr === 'number') {
        return l[Math.floor(mr % l.length)] // Chord index
      } else {
        return l.map(lv => lookupOp(lv, mr, event,b,evalRecurse)) // Map lookup over the LHS
      }
    }
    if (typeof ml === 'string') {
      if (ml.toLowerCase() === 'this') { // lookup on this event
        let v = event[mr]
        v = evalRecurse(v, event,b) // Eval so that time modifiers get applied
        let result = (e,b,er) => v // Wrap into a function so we can set _thisVar to prevent doubling up of chords
        result._thisVar = true
        return result
      }
      let player = players.getById(ml)
      if (mr === 'exists') { return !!player ? 1 : 0 }
      if (player) { // lookup a param on another player's events
        let originalB = evalRecurse((e,originalB) => originalB, event,b)
        let es = player.currentEvent(originalB)
        if (mr === 'playing') { return es.length>0 ? 1 : 0 }
        let v = es.map(e => e[mr])
        if (v.length === 0) { v = 0 }
        if (v.length === 1) { v = v[0] }
        return evalRecurse(v, event,b) // Eval so that time modifiers get applied
      } else {
        return 0 // Not found as a player - should really return undefined now we have '?' operator, but this could be a breaking change
      }
    }
    if (typeof l === 'object' && !(l instanceof AudioNode)) {
      let result = l[mr] // Map lookup
      if (result === undefined && typeof mr === 'number') { return l } // If field lookup failed, return the entire map. This is useful when a chord of objects optimises down to a single object but you still want to have an indexer on it.
      return result
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
    let er = evalParamFrame

    assert(undefined, lookupOp())
    assert(1, lookupOp(1, undefined))
    assert(undefined, lookupOp(undefined, 1, {},0,er))
    assert(2, lookupOp([1,2], 1, {},0,er))
    assert(2, lookupOp([1,2], 1.5, {},0,er))
    assert(1, lookupOp([1,2], 2, {},0,er))
    assert([2,3], lookupOp([1,[2,3]], 1, {},0,v=>v))

    assert([1,4], lookupOp([1,2,3,4], [0,3], {},0,er))

    assert(1, lookupOp({v:1}, 'v', {},0,er))
    assert({b:1}, lookupOp({a:{b:1}}, 'a', {},0,er))
    assert(1, lookupOp(lookupOp({a:{b:1}}, 'a', {},0,er), 'b', {},0,er))
    assert({foo:1}, lookupOp({foo:1}, 0, {},0,er))
    assert(undefined, lookupOp({foo:1}, 'bar', {},0,er))

    players.instances.p1 = { currentEvent:(b)=>{ return []} }
    assert(0, lookupOp('p1', 'foo', {},0,er))
    delete players.instances.p1
  
    players.instances.p1 = { currentEvent:(b)=>{ return [{foo:b}]} }
    assert(0, lookupOp('p1', 'foo', {},0,(v)=>0))
    assert(2, lookupOp('p1', 'foo', {},2,(v)=>2))
    delete players.instances.p1
  
    players.instances.p1 = { currentEvent:(b)=>{ return [{foo:b},{foo:b}]} }
    assert([0,0], lookupOp('p1', 'foo', {},0,er))
    assert([2,2], lookupOp('p1', 'foo', {},2,er))
    delete players.instances.p1
  
    assert(0, lookupOp('p1', 'exists', {},0,er))
    players.instances.p1 = { currentEvent:(b)=>{ return []} }
    assert(1, lookupOp('p1', 'exists', {},0,er))
    delete players.instances.p1
  
    players.instances.p1 = { currentEvent:(b)=>{ return []} }
    assert(0, lookupOp('p1', 'playing', {},0,er))
    delete players.instances.p1
    players.instances.p1 = { currentEvent:(b)=>{ return [{}]} }
    assert(1, lookupOp('p1', 'playing', {},0,er))
    delete players.instances.p1
  
    assert(0, lookupOp('p1', 'foo', {},2,er))
  
    assert(1, lookupOp('this', 'foo', {foo:1},0,er)())

    addVarFunction('foo', (v)=>mainParam(v))
    assert(1, lookupOp(1, 'foo', {},0,er))
    assert(2, lookupOp(2, {value:'foo'}, {},0,er))
    remove('foo')

    players.instances.p1 = { currentEvent:()=>{ return [{foo:1}]} }
    players.instances.p2 = { currentEvent:()=>{ return [{foo:2}]} }
    assert([1,2], lookupOp(['p1','p2'], 'foo', {},0,er))
    delete players.instances.p1
    delete players.instances.p2

    console.log('lookupOp tests complete')
  }
  return lookupOp
})