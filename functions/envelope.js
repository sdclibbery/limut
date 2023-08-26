'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction
  let {subParam} = require('player/sub-param')
  let {evalParamFrame} = require('player/eval-param')

  let scaledBeatEnv = (args, e,b,state, scale) => {
    let count = b - e.count
    if (count < 0) { count = 0 } // Clamp to get initial value if evalled early
    // Attack
    let a = subParam(args, 'a', 0) * scale
    if (count < a) { return count/a }
    count -= a
    // Decay
    let d = subParam(args, 'd', 0) * scale
    if (count < d) { return 1 - count/d }
    // default
    return 0
  }

  let scale = {
    's': 1,
    'seconds': 1,
    'ms': 1/1000,
    'millis': 1/1000,
  }
  let envelope = (args, e,b,state) => {
    args = evalParamFrame(args, e,b) // Eval all args once
    let units = subParam(args, 'units', 'beat').toLowerCase()
    let timeScale = scale[units]
    if (timeScale !== undefined) {
      return scaledBeatEnv(args, e,b,state, timeScale / e.beat.duration) // ADSR in scaled time
    }
    return scaledBeatEnv(args, e,b,state, 1) // ADSR in beats
  }
  envelope.isDirectFunction = true
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

    p = parseExpression("envelope{units:'s'}")
    assert(0, evalParamFrame(p, ev(0,0,4), 0))
    assert(0, evalParamFrame(p, ev(0,0,4), 1))
    assert(0, evalParamFrame(p, ev(0,0,4), 2))
    assert(0, evalParamFrame(p, ev(0,0,4), 3))

    p = parseExpression("envelope{d:1}")
    assert(1, evalParamFrame(p, ev(1,2,2), 1))
    assert(1, evalParamFrame(p, ev(1,2,2), 2))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 2.5))
    assert(0, evalParamFrame(p, ev(1,2,2), 3))
    assert(0, evalParamFrame(p, ev(1,2,2), 4))

    p = parseExpression("envelope{d:1,unit:'BEATS'}")
    assert(1, evalParamFrame(p, ev(1,2,2), 2))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 2.5))
    assert(0, evalParamFrame(p, ev(1,2,2), 3))

    p = parseExpression("envelope{d:1,units:'s'}")
    assert(1, evalParamFrame(p, ev(1,2,2), 1))
    assert(1, evalParamFrame(p, ev(1,2,2), 2))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 3))
    assert(0, evalParamFrame(p, ev(1,2,2), 4))
    assert(0, evalParamFrame(p, ev(1,2,2), 5))

    p = parseExpression("envelope{d:1,units:'S'}")
    assert(1, evalParamFrame(p, ev(1,2,2), 2))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 3))
    assert(0, evalParamFrame(p, ev(1,2,2), 4))

    p = parseExpression("envelope{d:1,units:'sEConDs'}")
    assert(1, evalParamFrame(p, ev(1,2,2), 2))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 3))
    assert(0, evalParamFrame(p, ev(1,2,2), 4))

    p = parseExpression("envelope{d:1000,units:'ms'}")
    assert(1, evalParamFrame(p, ev(1,2,2), 2))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 3))
    assert(0, evalParamFrame(p, ev(1,2,2), 4))
    assert(0, evalParamFrame(p, ev(1,2,2), 5))

    p = parseExpression("envelope{d:1000,units:'MIllIS'}")
    assert(1, evalParamFrame(p, ev(1,2,2), 2))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 3))
    assert(0, evalParamFrame(p, ev(1,2,2), 4))
    assert(0, evalParamFrame(p, ev(1,2,2), 5))
  
    p = parseExpression("envelope{a:1,d:1}")
    assert(0, evalParamFrame(p, ev(1,2,2), 2))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 2.5))
    assert(1, evalParamFrame(p, ev(1,2,2), 3))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 3.5))
    assert(0, evalParamFrame(p, ev(1,2,2), 4))
    assert(0, evalParamFrame(p, ev(1,2,2), 5))

    console.log('Envelope function tests complete')
  }
})
  