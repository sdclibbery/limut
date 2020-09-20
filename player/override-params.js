'use strict';
define(function(require) {
  let operator = require('player/eval-operator')
  let evalParam = require('player/eval-param').evalParamEvent

  let multiplyEvents = (event) => {
    for (let k in event) {
      let v = event[k]
      if (Array.isArray(v)) {
        return v.flatMap(x => {
          let e = Object.assign({}, event)
          e[k] = x
          return multiplyEvents(e)
        })
      }
    }
    return [event]
  }

  let applyOp = (op, orig, over) => {
    if (orig === undefined) {
      return over
    } else if (over === undefined) {
      return orig
    } else {
      return operator(op, orig, over)
    }
  }
  let overrideOp = (original,override) => override
  let ignoreOp = (original,override) => original
  let addOp = (original,override) => applyOp((l,r)=>l+r, original, override)
  let paramOp = {
    time: ignoreOp,
    value: ignoreOp,
    add: addOp,
    delay: addOp,
  }

  let overrideParams = (params, overrides) => {
    let result = Object.assign({}, params)
    for (let k in overrides) {
      let op = paramOp[k]
      if (!op) { op = overrideOp }
      result[k] = op(result[k], overrides[k])
    }
    return result
}

  let overrideEventParams = (events, overrides) => {
    return events.flatMap(sourceEvent => {
      let event = overrideParams(sourceEvent, overrides)
      for (let k in overrides) {
        event[k] = evalParam(event[k], sourceEvent.idx, sourceEvent.count)
      }
      return multiplyEvents(event)
    })
  }

  // TESTS //

  let parseExpression = require('player/parse-expression')
  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let ev = ps => Object.assign({idx:0, count:0, value:'1'}, ps)
  let c

  assert([ev()], overrideEventParams([ev()], {}))
  assert([ev({delay:18})], overrideEventParams([ev({delay:10})], {value:'9', delay:8, time:7}))
  assert([ev({oct:3}),ev({oct:4})], overrideEventParams([ev()], {oct:()=>[3,4]}))
  assert([ev({add:2})], overrideEventParams([ev({add:2})], {}))
  assert([ev({add:3})], overrideEventParams([ev()], {add:3}))
  assert([ev({add:5})], overrideEventParams([ev({add:2})], {add:3}))
  assert([ev({add:6})], overrideEventParams([ev({add:2})], {add:() => 4}))
  assert([ev({add:5}),ev({add:6})], overrideEventParams([ev({add:2})], {add:()=>[3,4]}))
  
  c = overrideEventParams([ev()], {zoom:parseExpression('[2:4]l2@f')})
  assert(2, c[0].zoom(0,0))
  assert(3, c[0].zoom(1,1))

  console.log('Combine events tests complete')

  return {
    overrideEventParams: overrideEventParams,
    overrideParams: overrideParams,
  }
});
