'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction
  let {subParam,subParamUnits} = require('player/sub-param')
  let {evalParamFrame} = require('player/eval-param')
  
  let lerp = (v0, v1, t, t1) => {
    if (t < 0) { return v0 }
    if (t > t1) { return v1 }
    return v0 + (v1-v0) * t/t1
  }
  let expDown = (v0, v1, t, t1) => {
    if (v0 <= 0) { return v0 }
    if (v1 <= 0) { v1 = 0.0001 }
    if (t < 0) { return v0 }
    if (t > t1) { return v1 }
    return v0 * Math.pow(v1/v0, t/t1)
  }
  let exp = (v0, v1, t, t1) => {
    if (v0 > v1) { return expDown(v0,v1,t,t1) }
    return v1 - expDown(v1,v0,t,t1)
  }
  let shapes = {
    'lin': lerp,
    'linear': lerp,
    'exp': exp,
    'exponential': exp,
  }
  let envelope = (args, e,b,state) => {
    args = evalParamFrame(args, e,b) // Eval all args once
    let count = b - e.count
    if (count < 0) { count = 0 } // Clamp to get initial value if evalled early
    let shape = subParam(args, 'shape')
    let interp = shapes[shape] || exp
    // Attack
    let a = subParamUnits(args, 'a', 'b', 0)
    if (count < a) { return interp(0,1, count,a) }
    count -= a
    // Decay
    let d = subParamUnits(args, 'd', 'b', 0)
    if (count < d) { return interp(1,0, count,d) }
    count -= d
    // default
    return 0
  }
  addVarFunction('envelope', envelope)


  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual, msg) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`+(msg?'\n'+msg:'')) }
    }
    require('predefined-vars').apply(require('vars').all())
    let parseExpression = require('expression/parse-expression')
    let ev = (t,c,d) => {return{idx:0,count:c,dur:d,_time:t,voice:0,beat:{duration:t/c}}}
    let p

    p = parseExpression("envelope{}")
    assert(0, evalParamFrame(p, ev(0,0,4), 0))
    assert(0, evalParamFrame(p, ev(0,0,4), 1))
    assert(0, evalParamFrame(p, ev(0,0,4), 2))
    assert(0, evalParamFrame(p, ev(0,0,4), 3))

    p = parseExpression("envelope{d:1,shape:'lin'}")
    assert(1, evalParamFrame(p, ev(1,2,2), 1))
    assert(1, evalParamFrame(p, ev(1,2,2), 2))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 2.5))
    assert(0, evalParamFrame(p, ev(1,2,2), 3))
    assert(0, evalParamFrame(p, ev(1,2,2), 4))

    p = parseExpression("envelope{d:1,shape:'exp'}")
    assert(1, evalParamFrame(p, ev(1,2,2), 2))
    assert(0.01, evalParamFrame(p, ev(1,2,2), 2.5))
    assert(0, evalParamFrame(p, ev(1,2,2), 3))

    p = parseExpression("envelope{d:1,shape:'lin'}")
    assert(1, evalParamFrame(p, ev(1,2,2), 2))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 2.5))
    assert(0, evalParamFrame(p, ev(1,2,2), 3))

    p = parseExpression("envelope{d:2,shape:'lin'}")
    assert(1, evalParamFrame(p, ev(1,2,2), 1))
    assert(1, evalParamFrame(p, ev(1,2,2), 2))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 3))
    assert(0, evalParamFrame(p, ev(1,2,2), 4))
    assert(0, evalParamFrame(p, ev(1,2,2), 5))

    p = parseExpression("envelope{a:1,d:1,shape:'lin'}")
    assert(0, evalParamFrame(p, ev(1,2,2), 2))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 2.5))
    assert(1, evalParamFrame(p, ev(1,2,2), 3))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 3.5))
    assert(0, evalParamFrame(p, ev(1,2,2), 4))
    assert(0, evalParamFrame(p, ev(1,2,2), 5))
  
    p = parseExpression("envelope{a:{value:1,_units:'s'}")
    assert(0, evalParamFrame(p, ev(1,2,2), 2))
    assert(0.92, evalParamFrame(p, ev(1,2,2), 2.5))

    console.log('Envelope function tests complete')
  }
})
  