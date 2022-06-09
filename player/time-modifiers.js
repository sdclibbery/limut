'use strict';
define(function(require) {
  let number = require('player/parse-number')

  let overrideKey = (v) => Math.round(v*16384)/16384

  let addModifiers = (exp, modifiers) => {
    if (!modifiers) { return exp }
    let overrides = new Map()
    for (const [key, value] of Object.entries(modifiers)) {
     let state = { str: key, idx: 0, }
       let n = number(state)
       if (n !== undefined) {
        let rounded = overrideKey(n)
        overrides.set(rounded, value)
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

    assert(2, addModifiers(1, {bar:2,'1':2}).modifiers.overrides.get(1))
    assert(2, addModifiers(1, {bar:2,'1/2':2}).modifiers.overrides.get(0.5))
    assert(2, addModifiers(1, {bar:2,'1/3':2}).modifiers.overrides.get(0.33331298828125))

    console.log('Time modifiers tests complete')
  }

  return {
    overrideKey: overrideKey,
    addModifiers: addModifiers,
  }
})