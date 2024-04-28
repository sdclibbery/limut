'use strict';
define(function(require) {
  let number = require('expression/parse-number')
  let {units} = require('units')

  let overrideKey = (v) => '@'+Math.round(v*16384)/16384

  let canHaveOwnModifiers = (value) => value !== undefined && typeof value === 'function'

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
    if (Object.keys(overrides).length > 0) { modifiers.overrides = overrides }
    if (!canHaveOwnModifiers(exp)) {
      let wrap = () => exp
      wrap.modifiers = modifiers
      return wrap
    }
    if (exp.modifiers === undefined) {
      exp.modifiers = modifiers
    } else {
      Object.assign(exp.modifiers, modifiers)
    }
    return exp
  }

  let makeStep = (x, step) => Math.floor(x/step)*step
  let applyModifiers = (results, mods, event, beat, interval) => {
    let modBeat = beat
    let modCount = event.count
    if (mods.per !== undefined) {
      let per = units(mods.per, 'b')
      modCount = modCount % per
      modBeat = modBeat % per
    }
    if (mods.step) {
      let step = units(mods.step, 'b')
      modCount = makeStep(modCount, step)
      modBeat = makeStep(modBeat, step)
    }
    if (mods.overrides !== undefined) {
      let bc = interval === 'frame' ? modBeat : modCount // Note overrides will not really work for per frame values, because you're very unlikely to actually hit the exact right count to trigger the override.
      let key = overrideKey(bc)
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
    assert({foo:1}, addModifiers({foo:1}))
    assert([1], addModifiers([1]))

    assert({bar:2}, addModifiers({foo:1}, {bar:2}).modifiers)

    let f = (x) => x
    assert(1, addModifiers(f, {bar:2})(1))
    assert({bar:2}, addModifiers(f, {bar:2}).modifiers)

    assert({bar:2}, addModifiers([0,1], {bar:2}).modifiers)
    assert({bar:2}, addModifiers([0,1], {bar:2}).modifiers)

    assert(1, addModifiers(1, {bar:2})())
    assert({bar:2}, addModifiers(1, {bar:2}).modifiers)

    assert("foo", addModifiers("foo", {bar:2})())
    assert({bar:2}, addModifiers("foo", {bar:2}).modifiers)

    assert(2, addModifiers(1, {bar:2,'1':2}).modifiers.overrides[overrideKey(1)])
    assert(2, addModifiers(1, {bar:2,'0.5':2}).modifiers.overrides[overrideKey(0.5)])
    assert(2, addModifiers(1, {bar:2,'1/2':2}).modifiers.overrides[overrideKey(0.5)])
    assert(2, addModifiers(1, {bar:2,'1/3':2}).modifiers.overrides[overrideKey(0.33333333333333)])
    assert(2, addModifiers(1, {bar:2,'1/3':2}).modifiers.overrides[overrideKey(0.33331298828125)])
    assert(2, addModifiers(1, {bar:2,'1/3':2}).modifiers.overrides[overrideKey(0.3333)])
    assert(undefined, addModifiers(1, {bar:2,'1/3':2}).modifiers.overrides[overrideKey(0.333)])

    let v = () => 0
    v.modifiers = {bar:3}
    assert(2, addModifiers(v, {foo:2}).modifiers.foo)
    assert(3, addModifiers(v, {foo:2}).modifiers.bar)

    console.log('Time modifiers tests complete')
  }

  return {
    overrideKey: overrideKey,
    addModifiers: addModifiers,
    applyModifiers: applyModifiers,
  }
})