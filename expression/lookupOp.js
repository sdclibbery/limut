'use strict';
define(function(require) {
  let players = require('player/players')
  let sections = require('section/sections')
  let vars = require('vars')
  let {mainParam} = require('player/sub-param')
  let {evalParamFrame,evalFunctionWithModifiers} = require('player/eval-param')
  let {addVarFunction,remove} = require('predefined-vars')
  let playerPre = require('play/player-pre')

  let lookupOp = (l,r, event,b,evalRecurse) => {
    let originalR = r
    if (l === undefined) { return undefined }
    if (r === undefined) { return l }
    if (typeof l === 'function' && typeof l._name === 'string' && typeof r === 'function' && typeof r._name === 'string' && l.modifiers === undefined) {
      let vl = vars.get(l._name) // Namespace type thing; eg osc.sin
      if ((typeof vl === 'object' || typeof vl === 'function') && vl[r._name] !== undefined) {
        r.namespace = l._name
        return r // Call the original RHS parse var function call, but using the LHS namespace the namespace
      }
    }
    l = evalRecurse(l, event,b)
    let ml = mainParam(l)
    if (typeof r === 'function' && typeof ml !== 'string') { // If LHS is a string, its either a player or 'this' or 'global', so aggregators (or any kind of calling a function on it) dont make sense
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
      let key = mr
      if (typeof originalR._name == 'string') { key = originalR._name } // Use the string name not the parse-var evalled value for preference for global lookups (so you can use global.foo not global.'foo')
      if (ml.toLowerCase() === 'global') { // lookup on global vars
        return vars.get(key)
      }
      if (ml.toLowerCase() === 'this') { // lookup on this event
        if (key === 'time') { // Special case for per event time
          let eventTime = (me,mb) => mb - me.count
          eventTime.modifiers = originalR.modifiers // Carry over any time modifiers
          return evalFunctionWithModifiers(eventTime, event,b, evalRecurse) // Time relative to the start of this event
        }
        let v = event[key]
        v = evalRecurse(v, event,b) // Eval so that time modifiers get applied
        let lookupOpResult = (e,b,er) => v // Wrap into a function so we can set _chordPlaceholder to prevent doubling up of chords
        lookupOpResult._chordPlaceholder = true
        return lookupOpResult
      }
      if (ml.toLowerCase() === 'section') { // lookup a param on the currently active section
        let section = sections.active
        if (section && section[key] !== undefined) { return evalRecurse(section[key], event,b) }
        return 0
      }
      let player = players.getById(ml)
      if (key === 'exists') { return !!player ? 1 : 0 }
      if (key === 'pre') { // Tap this player's pre-fx audio output as a connectable node (works even before the player exists)
        let id = ml.toLowerCase()
        let result = (e,b,er) => playerPre.getConsumerTap(id, (e && e._destructor) || (event && event._destructor))
        result._chordPlaceholder = true // Prevent chord expansion building audio nodes
        return result
      }
      if (player) { // lookup a param on another player's events
        let originalB = evalRecurse((e,originalB) => originalB, event,b)
        let es = player.currentEvent(originalB)
        if (key === 'playing') { return es.length>0 ? 1 : 0 }
        let v = es.map(e => evalRecurse(e[key], e,b)) // Eval so that time modifiers get applied
        if (v.length === 0) { return 0 }
        if (v.length === 1) { return v[0] }
        return v
      } else {
        let section = sections.getByName(ml) // lookup a param on a named section
        if (section && section[key] !== undefined) { return evalRecurse(section[key], event,b) }
        return 0 // Not found as a player - should really return undefined now we have '?' operator, but this could be a breaking change
      }
    }
    if (typeof l === 'object' && !(l instanceof AudioNode)) {
      if (typeof mr === 'string') { mr = mr.toLowerCase() } // Case insensitive map lookup
      return l[mr] // Map lookup
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
    assert(undefined, lookupOp({foo:1}, 'bar', {},0,er))
    assert(undefined, lookupOp({foo:1}, 170, {},0,er))
    assert(1, lookupOp({foo:1}, 'Foo', {},0,er))

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

    // Named-section param lookup
    sections.instances.drop = { name:'drop', foo:0.5 }
    assert(0.5, lookupOp('drop', 'foo', {},0,er))
    assert(0, lookupOp('drop', 'nope', {},0,er)) // Unknown param
    assert(0, lookupOp('nosuchsection', 'foo', {},0,er)) // Unknown section
    sections.instances.drop = { name:'drop', foo:(e,b)=>b } // Function-valued param
    assert(2, lookupOp('drop', 'foo', {},2,er))
    delete sections.instances.drop

    // Active-section keyword lookup
    sections.active = { name:'drop', foo:0.5 }
    assert(0.5, lookupOp('section', 'foo', {},0,er))
    assert(0, lookupOp('section', 'nope', {},0,er)) // Unknown param
    sections.active = undefined
    assert(0, lookupOp('section', 'foo', {},0,er)) // No active section

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

    // .pre — tap a player's pre-fx audio as a connectable node (works with no matching player)
    let preP1 = lookupOp('p1', 'pre', {},0,er)
    assert('function', typeof preP1)
    assert(true, !!preP1._chordPlaceholder) // Marked so chord expansion doesn't build nodes
    let nodeP1 = preP1({},0,er) // No _destructor: the shared registry node itself
    assert(true, nodeP1 instanceof AudioNode)
    assert(true, nodeP1 === lookupOp('p1', 'pre', {},0,er)({},0,er)) // Same id -> same registry node
    assert(true, nodeP1 !== lookupOp('p2', 'pre', {},0,er)({},0,er)) // Distinct id -> distinct node
    let registered = []
    let iso = preP1({_destructor:{ disconnect:(n)=>registered.push(n) }},0,er) // With a destructor: per-consumer isolation gain
    assert(true, iso instanceof AudioNode)
    assert(true, iso !== nodeP1) // Isolation gain, not the shared registry node
    assert(1, registered.length) // One teardown shim registered

    console.log('lookupOp tests complete')
  }
  return lookupOp
})