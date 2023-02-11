'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction
  let {mainParam,subParam} = require('player/sub-param')

  let roundWrapper = (fn) => {
    return (args) => {
      let to = subParam(args, 'to', 1)
      return fn(mainParam(args, 0)/to)*to
    }
  }
  addVarFunction('floor', roundWrapper(Math.floor))
  addVarFunction('ceil', roundWrapper(Math.ceil))
  addVarFunction('round', roundWrapper(Math.round))

  addVarFunction('euclid', (args, e) => {
    let k = Math.floor(mainParam(args, 1)) // Distribute k beats...
    let n = Math.floor(subParam(args, 'from', 1)) // ...between n steps
    let offset = Math.floor(subParam(args, 'offset', 0)) // ...rotated by offset
    n = Math.max(n, 1) // Must have at least one step
    k = Math.max(k, 1) // Must have at least one beat
    k = Math.min(k, n) // Can't have more beats than steps
    // Build the array of euclidean durations
    let x = 0
    let xi = 0
    let step = n/k
    let stepi = Math.ceil(step)
    let targetIdx = (e.idx + k - offset) % k
    let idx = 0
    let dur = 1
    do {
      dur = stepi
      if (xi > x) {
        dur--
      }
      xi += dur
      x += step
      idx++
    } while (idx <= targetIdx) // Stop when we've reached the value we need
    // console.log(k, n, targetIdx, dur)
    return {value:dur,_repeatCount:k}
  })

  let getVoiceState = (fullState, e,b) => {
    if (fullState.voices === undefined) { fullState.voices = {} }
    if (fullState.voices[e.voice] === undefined) { fullState.voices[e.voice] = {} }
    let state = fullState.voices[e.voice] // Store separate state for each chord voice
    if (!state.b || b > state.b) {
      let dt = b - (state.b || b)
      state.b = b
      state.dt = dt
    }
    return state
  }
  let statefulWrapper = (fn) => {
    return (args, e,b, fullState) => { // fullState is state per parse instance of the function
      let state = getVoiceState(fullState, e,b)
      let dt = state.dt
      if (dt === 0) { return state.v || 0 }
      let value = (mainParam(args, 0) || 0)
      if (typeof value !== 'number') { value = 0 }
      state.v = fn(args, (state.v || 0), value, dt)
      return state.v
    }
  }

  addVarFunction('accum', statefulWrapper( (args, v, x, dt) => v + Math.max(x,0)*dt ))
  addVarFunction('smooth', statefulWrapper( (args, v, x, dt) => {
    if (x > v) {
      let att = subParam(args, 'att', 8)
      return Math.min(v + (x-v)*att*dt, x)
    } else {
      let dec = subParam(args, 'dec', 4)
      return Math.max(v + (x-v)*dec*dt, x)
    }
  }))
  addVarFunction('rate', (args, e,b, fullState) => {
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

  let assert = (expected, actual, msg) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`+(msg?'\n'+msg:'')) }
  }
  require('predefined-vars').apply(require('vars').all())
  let parseExpression = require('player/parse-expression')
  let {evalParamFrame} = require('player/eval-param')
  let ev = (i,c,d,v) => {return{idx:i,count:c,dur:d,_time:c,voice:v}}
  let p

  assert(1, evalParamFrame(parseExpression('floor{1.5}'), ev(0,0), 0))
  assert(-2, evalParamFrame(parseExpression('floor{-1.5}'), ev(0,0), 0))
  assert(1/2, evalParamFrame(parseExpression('floor{0.6,to:1/2}'), ev(0,0), 0))
  assert(-1.5, evalParamFrame(parseExpression('floor{-1.2,to:1/2}'), ev(0,0), 0))

  assert(1, evalParamFrame(parseExpression('floor{[1.5,2.5]t1@e}'), ev(0,0), 0))
  assert(2, evalParamFrame(parseExpression('floor{[1.5,2.5]t1@e}'), ev(1,1), 1))
  assert(1, evalParamFrame(parseExpression('floor{[1.5,2.5]t1@f}'), ev(0,0), 0))
  assert(2, evalParamFrame(parseExpression('floor{[1.5,2.5]t1@f}'), ev(1,1), 1))
  assert([1,2], evalParamFrame(parseExpression('floor{(1.5,2.5)}'), ev(0,0), 0))

  assert(1, evalParamFrame(parseExpression("floor{1.5,2.5}"),ev(0,0,0),0))
  assert([1,2], evalParamFrame(parseExpression("floor{(1.5,2.5)}"),ev(0,0,0),0))
  assert(1, evalParamFrame(parseExpression("1.5 .floor"),ev(0,0,0),0))
  assert(1.25, evalParamFrame(parseExpression("(1.3).floor{to:1/4}"),ev(0,0,0),0))
  // assert([1,2], evalParamFrame(parseExpression("(1.5,2.5).floor"),ev(0,0,0),0))
  // assert([4/3,7/3], evalParamFrame(parseExpression("(1.5,2.5).floor{to:1/3}"),ev(0,0,0),0))
  assert(2.5, evalParamFrame(parseExpression("(1.5,2.5).floor{1.5}"),ev(0,0,0),0))

  assert(2, evalParamFrame(parseExpression('ceil{1.5}'), ev(0,0), 0))
  assert(-1, evalParamFrame(parseExpression('ceil{-1.5}'), ev(0,0), 0))
  assert(1/2, evalParamFrame(parseExpression('ceil{0.4,to:1/2}'), ev(0,0), 0))
  assert(-1.5, evalParamFrame(parseExpression('ceil{-1.7,to:1/2}'), ev(0,0), 0))

  assert(2, evalParamFrame(parseExpression('round{1.51}'), ev(0,0), 0))
  assert(1, evalParamFrame(parseExpression('round{1.49}'), ev(0,0), 0))
  assert(-1, evalParamFrame(parseExpression('round{-1.4}'), ev(0,0), 0))
  assert(1/2, evalParamFrame(parseExpression('round{0.4,to:1/2}'), ev(0,0), 0))
  assert(-1.5, evalParamFrame(parseExpression('round{-1.7,to:1/2}'), ev(0,0), 0))

  assert(0, evalParamFrame(parseExpression('accum{0}'), ev(0,0), 0))

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

  p = parseExpression('smooth{{4}}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(0, evalParamFrame(p, ev(0,0), 2))

  assert(0, evalParamFrame(parseExpression('rate{0}'), ev(0,0), 0))

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

  let testEuclid = (expected, expectedLength, expectedIdxLength, p) => {
    for (let i=0; i<expected.length; i++) {
      let v = evalParamFrame(p, ev(i,0), 0)
      assert(expected[i], mainParam(v), `Main Index ${i} of expected ${expected}`)
      assert(expectedIdxLength, subParam(v,'_repeatCount'), `Count: Index ${i}`)
    }
  }
  testEuclid([1], 1, 1, parseExpression('euclid{3}'))
  testEuclid([1], 1, 1, parseExpression('euclid{0,from:0}'))
  testEuclid([1], 1, 1, parseExpression('euclid{1,from:1}'))
  testEuclid([1], 1, 1, parseExpression('euclid{2,from:1}'))

  testEuclid([2], 2, 1, parseExpression('euclid{1,from:2}'))
  testEuclid([2,1], 3, 2, parseExpression('euclid{2,from:3}'))
  testEuclid([2,2], 4, 2, parseExpression('euclid{2,from:4}'))
  testEuclid([3,2,3], 8, 3, parseExpression('euclid{3,from:8}'))
  testEuclid([3,2,3,2,3], 13, 5, parseExpression('euclid{5,from:13}'))

  testEuclid([3,2,3], 8, 3, parseExpression('euclid{3,from:8,offset:0}'))
  testEuclid([3,3,2], 8, 3, parseExpression('euclid{3,from:8,offset:1}'))
  testEuclid([2,3,3], 8, 3, parseExpression('euclid{3,from:8,offset:2}'))
  testEuclid([3,2,3], 8, 3, parseExpression('euclid{3,from:8,offset:3}'))

  console.log('Maths tests complete')
  }
})
