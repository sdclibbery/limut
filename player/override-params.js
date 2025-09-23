'use strict';
define(function(require) {
  let applyOperator = require('expression/eval-operator')

  let isOverride = (v) => Array.isArray(v) && v._override

  let setOp = (l,r) => r
  let newOverride = (value, operator, string) => {
    if (!operator) { operator = setOp } // Replace previous value if no combining operator specified
    let ov = [{value:value,operator:operator,string:string}]
    ov._override = true
    return ov
  }

  let combineOverride = (oldO, newO) => {
    if (!isOverride(newO) || oldO === undefined) {
      return newO // just replace
    }
    if (!isOverride(oldO)) {
      oldO = newOverride(oldO) // If old isn't already an override, make it one
    }
    oldO.push(...newO) // Combine override arrays
    return oldO
  }

  let combineOverrides = (oldOverrides, newOverrides) => {
    let result = Object.assign({}, oldOverrides)
    for (let k in newOverrides) {
      result[k] = combineOverride(result[k], newOverrides[k])
    }
    return result
  }

  let applyOverride = (params, param, override) => {
    if (isOverride(override)) {
      if (param === 'fx') {
        params._fxString = override.reduce((orig, over) => {
          let opName = !!over.operator ? over.operator.name : ''
          if (opName === 'setOp') {
            return over.string
          } else {
            if (orig === undefined) { return over.string }
            if (opName === 'connectOp') { opName = '>>' }
            return orig + opName + over.string
          }
        }, params._fxString || params.fx)
      }
      return override.reduce((orig, over) => {
        if (orig === undefined) { return over.value }
        if (over.operator.name === 'setOp') { return over.value }
        return applyOperator(over.operator, orig, over.value)
      }, params[param])
    } else {
        if (param === 'fx') { params._fxString = ''+override }
        return override
    }
  }

  let applyOverridesInPlace = (params, overrides) => {
    for (let k in overrides) {
      if (k === '_time' || k === 'value') { continue } // Do not override these values
      params[k] = applyOverride(params, k, overrides[k])
    }
  }

  let applyOverrides = (params, overrides) => {
    let result = Object.assign({}, params)
    applyOverridesInPlace(result, overrides)
    return result
  }

  let collapseOverrides = (overrides) => {
    for (let k in overrides) {
      overrides[k] = applyOverride(overrides, undefined, overrides[k])
    }
    return overrides
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
  let ops = {
    '+': (l,r) => l+r,
    '*': (l,r) => l*r,
    '/': (l,r) => l/r,
  }
  let opAdd = ops['+']
  let opMul = ops['*']
  let opDiv = ops['/']
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

  overrides = {add:newOverride(3, opAdd)}
  overrides = combineOverrides(overrides, {add:newOverride(2, opDiv)})
  assert(ev({add:2}), applyOverrides(ev({add:1}), overrides))

  overrides = {add:combineOverride(undefined, newOverride(2, opAdd))}
  assert(ev({add:3}), applyOverrides(ev({add:1}), overrides))

  overrides = {add:combineOverride(1, newOverride(2, opAdd))}
  assert(ev({add:3}), applyOverrides(ev({}), overrides))

  overrides = {add:combineOverride(newOverride(2, opAdd), 1)}
  assert(ev({add:1}), applyOverrides(ev({}), overrides))

  overrides = {add:combineOverride(1, 2)}
  assert(ev({add:2}), applyOverrides(ev({}), overrides))

  assert({add:1}, collapseOverrides({add:1}))
  assert({add:2}, collapseOverrides({add:newOverride(2)}))

  overrides = {add:combineOverride(1, newOverride(2, opAdd))}
  assert({add:3}, collapseOverrides(overrides))

  assert({fx:2,_fxString:'2'}, applyOverrides({fx:2,_fxString:'2'}, {}))
  assert({_fxString:'2',fx:2}, applyOverrides({}, {fx:2}))
  assert({_fxString:'2',fx:2}, applyOverrides({}, {fx:2,_fxString:'2'}))
  assert({_fxString:'2',fx:2}, applyOverrides({}, {fx:newOverride(2,undefined,'2')}))
  assert({fx:3,_fxString:'3'}, applyOverrides({fx:2}, {fx:3}))
  assert({fx:3,_fxString:'3'}, applyOverrides({fx:2,_fxString:'2'}, {fx:3}))
  assert({fx:3,_fxString:'3'}, applyOverrides({fx:2}, {fx:newOverride(3,undefined,'3')}))
  assert({fx:3,_fxString:'3'}, applyOverrides({fx:2,_fxString:'2'}, {fx:newOverride(3,undefined,'3')}))
  assert({_fxString:'3',fx:3}, applyOverrides({}, {fx:newOverride(3,opAdd,'3')}))
  assert({fx:5,_fxString:'2+3'}, applyOverrides({fx:2}, {fx:newOverride(3,opAdd,'3')}))
  assert({fx:5,_fxString:'2+3'}, applyOverrides({fx:2,_fxString:'2'}, {fx:newOverride(3,opAdd,'3')}))

  console.log('Override params tests complete')
  }

  return {
    newOverride: newOverride,
    combineOverride: combineOverride,
    combineOverrides: combineOverrides,
    collapseOverrides: collapseOverrides,
    applyOverrides: applyOverrides,
    applyOverridesInPlace: applyOverridesInPlace,
    isOverride: isOverride,
  }
});
