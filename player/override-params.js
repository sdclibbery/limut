'use strict';
define(function(require) {

  let newOverride = (value, operator) => {
    let ov
    if (operator) {
      ov = (original) => operator(original, value)
    } else {
      ov = (original) => value
    }
    ov._override = true
    return ov
  }

  let combineOverrides = (oldOverrides, newOverrides) => {
    let result = Object.assign({}, oldOverrides)
    for (let k in newOverrides) {
      result[k] = newOverrides[k]
    }
    return result
  }

  let applyOverrides = (params, overrides) => {
    let result = Object.assign({}, params)
    for (let k in overrides) {
      if (k === '_time' || k === 'value') { continue } // Do not override these values
      result[k] = overrides[k](result[k])
    }
    return result
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let ev = ps => Object.assign({idx:0, count:0, value:'1'}, ps)
  let opAdd = (l,r) => l+r

  assert(ev(), applyOverrides(ev(), {}))
  assert(ev({add:2}), applyOverrides(ev({add:2}), {}))
  assert(ev({add:3}), applyOverrides(ev({}), {add:newOverride(3)}))
  assert(ev({add:3}), applyOverrides(ev({add:2}), {add:newOverride(3)}))
  assert(ev({delay:8}), applyOverrides(ev({delay:10}), {value:newOverride('9'), delay:newOverride(8), _time:newOverride(7)}))

  assert(ev({add:5}), applyOverrides(ev({add:2}), {add:newOverride(3, opAdd)}))

  console.log('Override params tests complete')
  }

  return {
    newOverride: newOverride,
    combineOverrides: combineOverrides,
    applyOverrides: applyOverrides,
  }
});
