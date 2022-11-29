'use strict';
define(function(require) {
  let players = require('player/players')
  let {mainParam, subParam} = require('player/sub-param')
  let {evalParamFrame} = require('player/eval-param')
  let {getVarFunction,addVarFunction,remove} = require('predefined-vars')

  let lookupOp = (l,r, event,b,evalRecurse) => {
    if (l === undefined) { return undefined }
    if (r === undefined) { return l }
    if (Array.isArray(r)) {
      return r.map(rv => lookupOp(l, rv, event,b,evalRecurse)) // If RHS is a chord, map the lookup of each element
    }
    let varFunc = getVarFunction(mainParam(r))
    if (varFunc) {
      if (!varFunc._isAggregator && Array.isArray(l)) { // If var function is NOT an aggregator...
        return l.map(lv => lookupOp(lv, r, event,b,evalRecurse)) // then map it over LHS array instead of passing LHS array to it
      }
      let args = l
      if (typeof r === 'object') {
        args = Object.assign({}, r)
        args.value = l
      }
      let state = subParam(r, '_state') // Extract state to support stateful var functions
      return varFunc(args, event,b, state) // Var function, eg chord aggregator or maths function
    }
    if (Array.isArray(l)) {
      if (typeof r === 'number') {
        return l[Math.floor(r % l.length)] // Chord index
      } else if (typeof r === 'string') {
        return l.map(lv => lookupOp(lv, r, event,b,evalRecurse)) // If RHS is a string, map lookup over the LHS
      }
    }
    if (typeof l === 'object') {
      let result = l[r] // Map lookup
      if (result === undefined && typeof r === 'number') { return l } // If numeric lookup failed, return the entire map. This is useful when a chord of objects optimises down to a single object but you still want to have an indexer on it.
      return result
    }
    if (typeof l === 'string') {
      if (l.toLowerCase() === 'this') {
        let v = event[r]
        v = evalParamFrame(v, event,b) // Eval so that time modifiers get applied
        let result = (e,b,er) => v // Wrap into a function so we can set _thisVar to prevent doubling up of chords
        result._thisVar = true
        return result
      }
      let player = players.instances[l]
      if (player) { // lookup a param on player events
        let originalB = evalRecurse((e,originalB) => originalB, event, b)
        let es = player.currentEvent(originalB)
        let v = es.map(e => e[r])
        if (v.length === 0) { v = 0 }
        if (v.length === 1) { v = v[0] }
        return evalParamFrame(v, event,b) // Eval so that time modifiers get applied
      }
      else {
        return 0 // Fallback to zero if not found as a player
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

    assert([1,4], lookupOp([1,2,3,4], [0,3]))

    assert(1, lookupOp({v:1}, 'v'))
    assert({b:1}, lookupOp({a:{b:1}}, 'a'))
    assert(1, lookupOp(lookupOp({a:{b:1}}, 'a'), 'b'))
    assert({foo:1}, lookupOp({foo:1}, 0))
    assert(undefined, lookupOp({foo:1}, 'bar'))

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
  
    assert(0, lookupOp('p1', 'foo', {},2,(v)=>2))
  
    assert(1, lookupOp('this', 'foo', {foo:1},0,(v)=>0)())

    assert(2, lookupOp([1,2], 'max'))
    assert(2, lookupOp(2, 'max'))

    addVarFunction('foo', (v)=>mainParam(v))
    assert(1, lookupOp(1, 'foo'))
    assert(2, lookupOp(2, {value:'foo'}))
    remove('foo')

    addVarFunction('foo', (v,e,b,s)=>s)
    assert(5, lookupOp(2, {value:'foo',_state:5}))
    remove('foo')

    players.instances.p1 = { currentEvent:()=>{ return [{foo:1}]} }
    players.instances.p2 = { currentEvent:()=>{ return [{foo:2}]} }
    assert([1,2], lookupOp(['p1','p2'], 'foo', {},0,(v)=>0))
    delete players.instances.p1
    delete players.instances.p2
  
    addVarFunction('foo', (v,e,b,s)=>mainParam(v)+1)
    assert([2,3], lookupOp([1,2], 'foo'))
    assert([2,3], lookupOp([1,2], {value:'foo'}))
    assert([2,3], lookupOp([1,2], {value:'foo',_state:5}))
    remove('foo')

    console.log('lookupOp tests complete')
  }
  return lookupOp
})