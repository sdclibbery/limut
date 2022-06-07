'use strict';
define(function(require) {
  let number = require('player/parse-number')

  let wrapWithModifiers = (exp, modifiers) => {
    if (!modifiers) { return exp }
    let overrides = new Map()
    for (const [key, value] of Object.entries(modifiers)) {
     let state = { str: key, idx: 0, }
       let n = number(state)
       if (n !== undefined) {
        let rounded = Math.round(n*16384)/16384
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
  
    assert(1, wrapWithModifiers(1))

    assert({foo:1,modifiers:{bar:2,overrides:{}}}, wrapWithModifiers({foo:1}, {bar:2}))

    let f = (x) => x
    assert(1, wrapWithModifiers(f, {bar:2})(1))
    assert({bar:2,overrides:{}}, wrapWithModifiers(f, {bar:2}).modifiers)

    assert([0,1], wrapWithModifiers([0,1], {bar:2}))
    assert({bar:2,overrides:{}}, wrapWithModifiers([0,1], {bar:2}).modifiers)

    assert(1, wrapWithModifiers(1, {bar:2})())
    assert({bar:2,overrides:{}}, wrapWithModifiers(1, {bar:2}).modifiers)

    assert("foo", wrapWithModifiers("foo", {bar:2})())
    assert({bar:2,overrides:{}}, wrapWithModifiers("foo", {bar:2}).modifiers)

    assert(2, wrapWithModifiers(1, {bar:2,'1':2}).modifiers.overrides.get(1))
    assert(2, wrapWithModifiers(1, {bar:2,'1/2':2}).modifiers.overrides.get(0.5))
    assert(2, wrapWithModifiers(1, {bar:2,'1/3':2}).modifiers.overrides.get(0.33331298828125))

    console.log('Time modifiers tests complete')
  }

  return {
    wrapMods: wrapWithModifiers,
  }
})