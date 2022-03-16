'use strict';
define(function(require) {

  let isOverrideFunc = (v) => typeof v == 'function' && v._override

  let newOverride = (value, operator) => {
    return value
  }

  let combineOverrides = (oldOverrides, newOverrides) => {
    let result = Object.assign({}, oldOverrides)
    for (let k in newOverrides) {
      let ov = newOverrides[k]
      if (isOverrideFunc(ov)) {
        result[k] = ov(result[k]) // NO! Combine into new function somehow. Need tests for this!!!
      } else {
        result[k] = ov
      }
    }
    return result
  }

  let applyOverrides = (params, overrides) => {
    let result = Object.assign({}, params)
    for (let k in overrides) {
      if (k === '_time' || k === 'value') { continue } // Do not override these values
      let ov = overrides[k]
      if (isOverrideFunc(ov)) {
        result[k] = ov(result[k])
      } else {
        result[k] = ov
      }
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
  let c

  assert(ev(), applyOverrides(ev(), {}))
  assert(ev({delay:8}), applyOverrides(ev({delay:10}), {value:'9', delay:8, _time:7}))
  assert(ev({add:2}), applyOverrides(ev({add:2}), {}))
  assert(ev({add:3}), applyOverrides(ev({}), {add:3}))

  let ovChooseOverride = (original) => 7
  ovChooseOverride._override = true
  let ovChooseOriginal = (original) => original
  ovChooseOriginal._override = true
  let ovAddSeven = (original) => original+7
  ovAddSeven._override = true

  assert(ev({add:7}), applyOverrides(ev({add:3}), {add:ovChooseOverride}))
  assert(ev({add:3}), applyOverrides(ev({add:3}), {add:ovChooseOriginal}))
  assert(ev({add:10}), applyOverrides(ev({add:3}), {add:ovAddSeven}))

  console.log('Override params tests complete')
  }

  return {
    newOverride: newOverride,
    combineOverrides: combineOverrides,
    applyOverrides: applyOverrides,
  }
});
