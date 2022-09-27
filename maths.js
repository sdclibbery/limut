'use strict'
define(function(require) {
  let vars = require('vars')
  let {mainParam,subParam} = require('player/sub-param')

  let createFunc = (name, fn) => {
    let func = (args, e,b, state) => {
      return fn(args, e,b, state)
    }
    func.isVarFunction = true
    vars[name] = func
  }

  let roundWrapper = (fn) => {
    return (args) => {
      let to = subParam(args, 'to', 1)
      return fn(mainParam(args, 0)/to)*to
    }
  }
  createFunc('floor', roundWrapper(Math.floor))
  createFunc('ceil', roundWrapper(Math.ceil))
  createFunc('round', roundWrapper(Math.round))

  let getVoiceState = (fullState, e,b) => {
    if (fullState.voices === undefined) { fullState.voices = {} }
    if (fullState.voices[e.voice] === undefined) { fullState.voices[e.voice] = {} }
    let state = fullState.voices[e.voice] // Store separate state for each chord voice
    let dt = b - (state.b || b)
    state.b = b
    state.dt = dt
    return state
  }
  let statefulWrapper = (fn) => {
    return (args, e,b, fullState) => {
      let state = getVoiceState(fullState, e,b)
      let dt = state.dt
      if (dt === 0) { return 0 }
      let value = (mainParam(args, 0) || 0)
      state.v = fn(args, (state.v || 0), value, dt)
      return state.v
    }
  }

  createFunc('accum', statefulWrapper( (args, v, x, dt) => v + Math.max(x,0)*dt ))
  createFunc('smooth', statefulWrapper( (args, v, x, dt) => {
    if (x > v) {
      let att = subParam(args, 'att', 8)
      return Math.min(v + (x-v)*att*dt, x)
    } else {
      let dec = subParam(args, 'dec', 4)
      return Math.max(v + (x-v)*dec*dt, x)
    }
  }))
  createFunc('rate', (args, e,b, fullState) => {
    let state = getVoiceState(fullState, e,b)
    let dt = state.dt
    if (dt === 0) { return 0 }
    let x = (mainParam(args, 0) || 0)
    let last = state.last===undefined ? x : state.last
    let rate = (x - last)/dt
    state.last = x
    return rate || 0
  })

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let parseExpression = require('player/parse-expression')
  let {evalParamFrame} = require('player/eval-param')
  let ev = (i,c,d,v) => {return{idx:i,count:c,dur:d,_time:c,voice:v}}
  let p

  assert(0, evalParamFrame(parseExpression('floor'), ev(0,0), 0))
  assert(0, evalParamFrame(parseExpression('floor{}'), ev(0,0), 0))
  assert(1, evalParamFrame(parseExpression('floor{1.5}'), ev(0,0), 0))
  assert(-2, evalParamFrame(parseExpression('floor{-1.5}'), ev(0,0), 0))
  assert(1/2, evalParamFrame(parseExpression('floor{0.6,to:1/2}'), ev(0,0), 0))
  assert(-1.5, evalParamFrame(parseExpression('floor{-1.2,to:1/2}'), ev(0,0), 0))

  assert(1, evalParamFrame(parseExpression('floor{[1.5,2.5]t1@e}'), ev(0,0), 0))
  assert(2, evalParamFrame(parseExpression('floor{[1.5,2.5]t1@e}'), ev(1,1), 1))
  assert(1, evalParamFrame(parseExpression('floor{[1.5,2.5]t1@f}'), ev(0,0), 0))
  assert(2, evalParamFrame(parseExpression('floor{[1.5,2.5]t1@f}'), ev(1,1), 1))
  assert([1,2], evalParamFrame(parseExpression('floor{(1.5,2.5)}'), ev(0,0), 0))

  assert(2, evalParamFrame(parseExpression('ceil{1.5}'), ev(0,0), 0))
  assert(-1, evalParamFrame(parseExpression('ceil{-1.5}'), ev(0,0), 0))
  assert(1/2, evalParamFrame(parseExpression('ceil{0.4,to:1/2}'), ev(0,0), 0))
  assert(-1.5, evalParamFrame(parseExpression('ceil{-1.7,to:1/2}'), ev(0,0), 0))

  assert(2, evalParamFrame(parseExpression('round{1.51}'), ev(0,0), 0))
  assert(1, evalParamFrame(parseExpression('round{1.49}'), ev(0,0), 0))
  assert(-1, evalParamFrame(parseExpression('round{-1.4}'), ev(0,0), 0))
  assert(1/2, evalParamFrame(parseExpression('round{0.4,to:1/2}'), ev(0,0), 0))
  assert(-1.5, evalParamFrame(parseExpression('round{-1.7,to:1/2}'), ev(0,0), 0))

  assert(0, evalParamFrame(parseExpression('accum'), ev(0,0), 0))
  assert(0, evalParamFrame(parseExpression('accum{}'), ev(0,0), 0))
  assert(0, evalParamFrame(parseExpression('accum{0}'), ev(0,0), 0))
  assert([0,0], evalParamFrame(parseExpression('accum{1,2}'), ev(0,0), 0))

  p = parseExpression('accum{1}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(1, evalParamFrame(p, ev(0,0), 2))
  assert(2, evalParamFrame(p, ev(0,0), 3))

  p = parseExpression('accum{-1}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(0, evalParamFrame(p, ev(0,0), 2))
  assert(0, evalParamFrame(p, ev(0,0), 3))

  p = parseExpression('accum{1}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(1/2, evalParamFrame(p, ev(0,0), 1.5))
  assert(1, evalParamFrame(p, ev(0,0), 2))

  p = parseExpression('accum{[1,2]t1@f}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(1, evalParamFrame(p, ev(0,0), 2))
  assert(3, evalParamFrame(p, ev(0,0), 3))
  assert(4, evalParamFrame(p, ev(0,0), 4))

  assert(0, evalParamFrame(parseExpression('smooth{0}'), ev(0,0), 0))
  assert([0,0], evalParamFrame(parseExpression('smooth{1,2}'), ev(0,0), 0))

  p = parseExpression('smooth{1,att:1,dec:0}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(1/2, evalParamFrame(p, ev(0,0), 1.5))
  assert(3/4, evalParamFrame(p, ev(0,0), 2))
  assert(1, evalParamFrame(p, ev(0,0), 3))

  p = parseExpression('smooth{1,att:1,dec:0}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(1, evalParamFrame(p, ev(0,0), 11))

  p = parseExpression('smooth{1,att:1/2,dec:0}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(1/2, evalParamFrame(p, ev(0,0), 2))
  assert(3/4, evalParamFrame(p, ev(0,0), 3))
  assert(7/8, evalParamFrame(p, ev(0,0), 4))

  p = parseExpression('smooth{-1,att:0,dec:1}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(-1/2, evalParamFrame(p, ev(0,0), 1.5))
  assert(-3/4, evalParamFrame(p, ev(0,0), 2))
  assert(-1, evalParamFrame(p, ev(0,0), 3))

  p = parseExpression('smooth{-1,att:0,dec:1}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(-1, evalParamFrame(p, ev(0,0), 11))

  assert(0, evalParamFrame(parseExpression('rate{0}'), ev(0,0), 0))
  assert([0,0], evalParamFrame(parseExpression('rate{1,2}'), ev(0,0), 0))

  p = parseExpression('rate{[0:1]l1@f}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(0, evalParamFrame(p, ev(0,0), 2))
  assert(1, evalParamFrame(p, ev(0,0), 3))
  assert(-1, evalParamFrame(p, ev(0,0), 4))
  assert(1, evalParamFrame(p, ev(0,0), 5))

  p = parseExpression('(0,1)+smooth{2}')
  assert([0,1], evalParamFrame(p, ev(0,0,1,0), 1))
  assert([0,1], evalParamFrame(p, ev(0,0,1,1), 1))
  assert([2,3], evalParamFrame(p, ev(0,0,1,0), 2))
  assert([2,3], evalParamFrame(p, ev(0,0,1,1), 2))

  console.log('Maths tests complete')
  }
})
