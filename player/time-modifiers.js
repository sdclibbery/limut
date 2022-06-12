'use strict';
define(function(require) {
  let number = require('player/parse-number')

  let overrideKey = (v) => '@'+Math.round(v*16384)/16384

  let addModifiers = (exp, modifiers) => {
    if (!modifiers) { return exp }
    let overrides = {}
    for (const [key, value] of Object.entries(modifiers)) {
     let state = { str: key, idx: 0, }
       let n = number(state)
       if (n !== undefined) {
        let key = overrideKey(n)
        overrides[key] = value
        delete modifiers[key]
      }
    }
    modifiers.overrides = overrides
    if (exp === undefined || typeof exp === 'number' || typeof exp === 'string') {
      let wrap = () => exp
      wrap.modifiers = modifiers
      return wrap
    }
    exp.modifiers = modifiers
    return exp
  }

  let applyModifiers = (results, mods, event, beat) => {
    let modBeat = beat
    let modCount = event.count
    if (mods.per !== undefined) {
      modCount = modCount % mods.per
      modBeat = modBeat % mods.per
    }
    if (mods.overrides !== undefined) {
      let key = overrideKey(modCount) // Use event.count (not beat) for overrides as overrides are essentially instantaneous
      let override = mods.overrides[key]
      if (override !== undefined) { return override }
    }
    results.modBeat = modBeat
    results.modCount = modCount
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
  
    assert(1, addModifiers(1))

    assert({foo:1,modifiers:{bar:2,overrides:{}}}, addModifiers({foo:1}, {bar:2}))

    let f = (x) => x
    assert(1, addModifiers(f, {bar:2})(1))
    assert({bar:2,overrides:{}}, addModifiers(f, {bar:2}).modifiers)

    assert([0,1], addModifiers([0,1], {bar:2}))
    assert({bar:2,overrides:{}}, addModifiers([0,1], {bar:2}).modifiers)

    assert(1, addModifiers(1, {bar:2})())
    assert({bar:2,overrides:{}}, addModifiers(1, {bar:2}).modifiers)

    assert("foo", addModifiers("foo", {bar:2})())
    assert({bar:2,overrides:{}}, addModifiers("foo", {bar:2}).modifiers)

    assert(2, addModifiers(1, {bar:2,'1':2}).modifiers.overrides[overrideKey(1)])
    assert(2, addModifiers(1, {bar:2,'0.5':2}).modifiers.overrides[overrideKey(0.5)])
    assert(2, addModifiers(1, {bar:2,'1/2':2}).modifiers.overrides[overrideKey(0.5)])
    assert(2, addModifiers(1, {bar:2,'1/3':2}).modifiers.overrides[overrideKey(0.33333333333333)])
    assert(2, addModifiers(1, {bar:2,'1/3':2}).modifiers.overrides[overrideKey(0.33331298828125)])
    assert(2, addModifiers(1, {bar:2,'1/3':2}).modifiers.overrides[overrideKey(0.3333)])
    assert(undefined, addModifiers(1, {bar:2,'1/3':2}).modifiers.overrides[overrideKey(0.333)])

    console.log('Time modifiers tests complete')
  }

  return {
    overrideKey: overrideKey,
    addModifiers: addModifiers,
    applyModifiers: applyModifiers,
  }
})