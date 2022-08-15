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

  let statefulWrapper = (fn) => {
    return (args, e,b, state) => {
      let dt = b - (state.b || b)
      state.b = b
      let target = (mainParam(args, 0) || 0)
      state.v = fn(args, (state.v || 0), target, dt)
      return state.v
    }
  }

  createFunc('accum', statefulWrapper( (args, v, t, dt) => v + t*dt ))
  createFunc('smooth', statefulWrapper( (args, v, t, dt) => {
    if (t > v) {
      let att = subParam(args, 'att', 8)
      return Math.min(v + (t-v)*att*dt, t)
    } else {
      let dec = subParam(args, 'dec', 4)
      return Math.max(v + (t-v)*dec*dt, t)
    }
  }))

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let parseExpression = require('player/parse-expression')
  let {evalParamFrame} = require('player/eval-param')
  let ev = (i,c,d) => {return{idx:i,count:c,dur:d,_time:c}}
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

  p = parseExpression('accum{1}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(1, evalParamFrame(p, ev(0,0), 2))
  assert(2, evalParamFrame(p, ev(0,0), 3))

  p = parseExpression('accum{1}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(1/2, evalParamFrame(p, ev(0,0), 1.5))
  assert(1, evalParamFrame(p, ev(0,0), 2))

  p = parseExpression('accum{[1,2]t1@f}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(1, evalParamFrame(p, ev(0,0), 2))
  assert(3, evalParamFrame(p, ev(0,0), 3))
  assert(4, evalParamFrame(p, ev(0,0), 4))

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

  console.log('Maths tests complete')
  }
})
