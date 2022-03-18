'use strict';
define(function(require) {
  let applyOperator = require('player/eval-operator')

  let isOverride = (v) => Array.isArray(v) && v._override

  let newOverride = (value, operator) => {
    if (!operator) {
      operator = (l,r) => r // Replace previous value if no combining operator specified
    }
    let ov = [{value:value,operator:operator}]
    ov._override = true
    return ov
  }

  let combineOverrides = (oldOverrides, newOverrides) => {
    let result = Object.assign({}, oldOverrides)
    for (let k in newOverrides) {
      if (isOverride(result[k]) && isOverride(newOverrides[k])) {
        result[k].push(...newOverrides[k]) // Combine override arrays
      } else {
        result[k] = newOverrides[k] // just replace
      }
    }
    return result
  }

  let applyOverrides = (params, overrides) => {
    let result = Object.assign({}, params)
    for (let k in overrides) {
      if (k === '_time' || k === 'value') { continue } // Do not override these values
      result[k] = overrides[k].reduce((original, override) => {
        return applyOperator(override.operator, original, override.value)
      }, result[k])
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
  let overrides
  let opAdd = (l,r) => l+r
  let opMul = (l,r) => l*r
  let evalParam = require('player/eval-param').evalParamFrame

  assert(ev(), applyOverrides(ev(), {}))
  assert(ev({add:2}), applyOverrides(ev({add:2}), {}))
  assert(ev({add:3}), applyOverrides(ev({}), {add:newOverride(3)}))
  assert(ev({add:3}), applyOverrides(ev({add:2}), {add:newOverride(3)}))
  assert(ev({delay:8}), applyOverrides(ev({delay:10}), {value:newOverride('9'), delay:newOverride(8), _time:newOverride(7)}))

  assert(ev({add:5}), applyOverrides(ev({add:2}), {add:newOverride(3, opAdd)}))

  overrides = {add:newOverride(3, opAdd)}
  overrides = combineOverrides(overrides, {add:newOverride(4, opAdd)})
  assert(ev({add:9}), applyOverrides(ev({add:2}), overrides))

  overrides = {add:newOverride(3, opAdd)}
  overrides = combineOverrides(overrides, {add:newOverride(4)})
  assert(ev({add:4}), applyOverrides(ev({add:2}), overrides))

  overrides = {add:newOverride(3)}
  overrides = combineOverrides(overrides, {add:newOverride(4, opAdd)})
  assert(ev({add:7}), applyOverrides(ev({add:2}), overrides))

  overrides = {add:newOverride(3, opAdd)}
  overrides = combineOverrides(overrides, {add:newOverride(2, opMul)})
  assert(ev({add:10}), applyOverrides(ev({add:2}), overrides))

  overrides = {add:newOverride(3, opAdd)}
  assert(5, evalParam(applyOverrides(ev({add:()=>2}), overrides).add,{},0))

  console.log('Override params tests complete')
  }

  return {
    newOverride: newOverride,
    combineOverrides: combineOverrides,
    applyOverrides: applyOverrides,
    isOverride: isOverride,
  }
});
