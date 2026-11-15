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

  let isPlainObject = (v) => typeof v === 'object' && v !== null && !(v instanceof AudioNode) && !v.isShaderNode && !v.isVisualTextureSource

  // Never mutate base: preset baseParams are shared between events
  let withSubParam = (base, sub, override) => {
    if (Array.isArray(base)) { return base.map(b => withSubParam(b, sub, override)) }
    if (typeof base === 'function') { // Might evaluate to a number or a map, so merge after evaluation
      let f = (e,b,er) => withSubParam(er(base,e,b), sub, override)
      if (base.interval) { f.interval = base.interval }
      return f
    }
    let result
    if (base === undefined) { result = {} }
    else if (isPlainObject(base)) { result = Object.assign({}, base) }
    else { result = {value: base} }
    let dot = sub.indexOf('.')
    if (dot > 0) {
      let head = sub.slice(0, dot)
      result[head] = withSubParam(result[head], sub.slice(dot+1), override)
    } else {
      result[sub] = applyOverride(result, sub, override)
    }
    return result
  }

  let applyOverridesInPlace = (params, overrides) => {
    for (let k in overrides) {
      if (k === '_time' || k === 'value') { continue } // Do not override these values
      let dot = k.indexOf('.')
      if (dot > 0) {
        let base = k.slice(0, dot)
        params[base] = withSubParam(params[base], k.slice(dot+1), overrides[k])
      } else {
        params[k] = applyOverride(params, k, overrides[k])
      }
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

  // Dotted subparam overrides
  assert({lpf:{value:300,q:10}}, applyOverrides({lpf:{value:300,q:5}}, {'lpf.q':newOverride(10)}))
  assert({lpf:{value:300,q:15}}, applyOverrides({lpf:{value:300,q:10}}, {'lpf.q':newOverride(5,opAdd)}))
  assert({lpf:{value:300,q:10}}, applyOverrides({lpf:300}, {'lpf.q':10}))
  assert({lpf:{q:10}}, applyOverrides({}, {'lpf.q':newOverride(10)}))
  assert({lpf:[{value:300,q:10},{value:600,q:10}]}, applyOverrides({lpf:[300,600]}, {'lpf.q':newOverride(10)}))
  assert({a:{value:1,b:{x:1,c:2}}}, applyOverrides({a:{value:1,b:{x:1}}}, {'a.b.c':newOverride(2)}))
  assert({a:{b:{value:3,c:2}}}, applyOverrides({a:{b:3}}, {'a.b.c':newOverride(2)}))
  let sharedBase = {value:300,q:5}
  let dotted = applyOverrides({lpf:sharedBase}, {'lpf.q':newOverride(10)})
  assert({value:300,q:5}, sharedBase)
  assert(undefined, dotted['lpf.q'])
  assert({x:{value:3,q:10}}, evalParam(applyOverrides({x:()=>3}, {'x.q':newOverride(10)}), {}, 0))
  assert({x:{h:1,v:1/2}}, evalParam(applyOverrides({x:()=>({h:1,v:1})}, {'x.v':newOverride(1/2)}), {}, 0))
  assert({x:{h:1,v:3/2}}, evalParam(applyOverrides({x:()=>({h:1,v:1})}, {'x.v':newOverride(1/2,opAdd)}), {}, 0))
  let fi = () => 3
  fi.interval = 'frame'
  assert('frame', applyOverrides({x:fi}, {'x.q':newOverride(10)}).x.interval)
  assert({lpf:300}, applyOverrides({}, {'lpf.q':newOverride(10), lpf:newOverride(300)}))

  console.log('Override params tests complete')
  }

  return {
    newOverride: newOverride,
    combineOverride: combineOverride,
    combineOverrides: combineOverrides,
    collapseOverrides: collapseOverrides,
    applyOverride: applyOverride,
    applyOverrides: applyOverrides,
    applyOverridesInPlace: applyOverridesInPlace,
    isOverride: isOverride,
  }
});
