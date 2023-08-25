'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction
  let {subParam} = require('player/sub-param')
  let {evalParamFrame} = require('player/eval-param')

  let scale = {
    's': 1,
    'ms': 1/1000,
  }
  let timeEnv = (args, e,b,state) => {
    let units = subParam(args, 'units', 's')
    let timeScale = scale[units] || 1
    let timeNow = b * e.beat.duration
    let time = timeNow - e._time
    if (time < 0) { return 0 }

    let a = subParam(args, 'a', 0) * timeScale
    if (time < a) { return time/a }
    time -= a

    let d = subParam(args, 'd', 0) * timeScale
    if (time < d) { return 1 - time/d }

    return 0    
  }

  let envelope = (args, e,b,state) => {
    args = evalParamFrame(args, e,b) // Eval all args once
    let units = subParam(args, 'units', 'beat')
    if (units !== 'beat') {
      return timeEnv(args, e,b,state)
    }
    throw `Envelope units 'beat' not supported yet!`
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

    p = parseExpression("envelope{units:'s'}")
    assert(0, evalParamFrame(p, ev(0,0,4), 0))
    assert(0, evalParamFrame(p, ev(0,0,4), 1))
    assert(0, evalParamFrame(p, ev(0,0,4), 2))
    assert(0, evalParamFrame(p, ev(0,0,4), 3))

    p = parseExpression("envelope{d:1,units:'s'}")
    assert(1, evalParamFrame(p, ev(1,2,2), 2))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 3))
    assert(0, evalParamFrame(p, ev(1,2,2), 4))
    assert(0, evalParamFrame(p, ev(1,2,2), 5))

    p = parseExpression("envelope{d:1000,units:'ms'}")
    assert(1, evalParamFrame(p, ev(1,2,2), 2))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 3))
    assert(0, evalParamFrame(p, ev(1,2,2), 4))
    assert(0, evalParamFrame(p, ev(1,2,2), 5))
  
    p = parseExpression("envelope{a:1,d:1,units:'s'}")
    assert(0, evalParamFrame(p, ev(1,2,2), 2))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 3))
    assert(1, evalParamFrame(p, ev(1,2,2), 4))
    assert(1/2, evalParamFrame(p, ev(1,2,2), 5))
    assert(0, evalParamFrame(p, ev(1,2,2), 6))
    assert(0, evalParamFrame(p, ev(1,2,2), 7))

    console.log('Envelope function tests complete')
  }
})
  