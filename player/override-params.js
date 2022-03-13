'use strict';
define(function(require) {
  let operator = require('player/eval-operator')
  let {operators} = require('player/operators')

  let overrideOp = (original,override) => override
  let paramOp = {
    add: operators['+'],
    delay: operators['+'],
  }

  let overrideParams = (params, overrides) => {
    let result = Object.assign({}, params)
    for (let k in overrides) {
      if (k === '_time' || k === 'value') { continue } // Do not override these values
      let op = paramOp[k]
      if (!op) { op = overrideOp }
      result[k] = operator(op, result[k], overrides[k])
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

  assert(ev(), overrideParams(ev(), {}))
  assert(ev({delay:18}), overrideParams(ev({delay:10}), {value:'9', delay:8, _time:7}))
  assert(ev({add:2}), overrideParams(ev({add:2}), {}))
  assert(ev({add:3}), overrideParams(ev({}), {add:3}))
  assert(ev({add:5}), overrideParams(ev({add:2}), {add:3}))
  
  console.log('Override params tests complete')
  }

  return {
    overrideParams: overrideParams,
  }
});
