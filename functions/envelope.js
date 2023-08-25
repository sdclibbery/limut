'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction
  let metronome = require('metronome')
  let {subParam} = require('player/sub-param')
  let {evalParamFrame} = require('player/eval-param')

  let scale = {
    's': 1,
    'ms': 1/1000,
  }
  let timeEnv = (args, e,b,state) => {
    let units = subParam(args, 'units', 'beat')
    let timeScale = scale[units] || 1
    let time = metronome.timeNow() - e._time
    if (time < 0) { return 0 }
    let d = subParam(args, 'd', 0) * timeScale
    if (time >= d) { return 0 }
    return 1 - time/d
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
    let assertAtTime = (time, expected, actualFn, msg) => {
      metronome.setTime(time)
      assert(expected, actualFn(), msg)
    }
    require('predefined-vars').apply(require('vars').all())
    let parseExpression = require('expression/parse-expression')
    let ev = (t,c,d) => {return{idx:0,count:c,dur:d,_time:t,voice:0}}
    let p

    p = parseExpression("envelope{units:'s'}")
    assertAtTime(0, 0, () => evalParamFrame(p, ev(0,0,1), 0))
    assertAtTime(1, 0, () => evalParamFrame(p, ev(0,0,1), 0))
    assertAtTime(2, 0, () => evalParamFrame(p, ev(1,1,1), 1))
    assertAtTime(0, 0, () => evalParamFrame(p, ev(1,1,1), 1))

    p = parseExpression("envelope{d:1,units:'s'}")
    assertAtTime(1, 1, () => evalParamFrame(p, ev(1,2,1), 2))
    assertAtTime(1.5, 1/2, () => evalParamFrame(p, ev(1,2,1), 2))
    assertAtTime(2, 0, () => evalParamFrame(p, ev(1,2,1), 2))
    assertAtTime(3, 0, () => evalParamFrame(p, ev(1,2,1), 2))

    p = parseExpression("envelope{d:1000,units:'ms'}")
    assertAtTime(1, 1, () => evalParamFrame(p, ev(1,2,1), 2))
    assertAtTime(1.5, 1/2, () => evalParamFrame(p, ev(1,2,1), 2))
    assertAtTime(2, 0, () => evalParamFrame(p, ev(1,2,1), 2))
    assertAtTime(3, 0, () => evalParamFrame(p, ev(1,2,1), 2))
  
    metronome.setTime(0)
    console.log('Envelope function tests complete')
  }
})
  