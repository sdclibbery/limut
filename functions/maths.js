'use strict'
define(function(require) {
  let {addVarFunction,add} = require('predefined-vars')
  let {mainParam,subParam} = require('player/sub-param')
  let {shaderAware} = require('draw/visualsynth/shader-maths')
  let {xmur3} = require('functions/rand')

  let argParam = v => mainParam(mainParam(v)) // One for getting the value from args, other for getting the value from the param

  // Every maths function is registered through shaderAware, so it emits GLSL when handed a visual
  // node (px=floor{id*4} or px=id>>floor{1/40}) and is unchanged for numbers
  let addMathsFunction = (name, fn) => addVarFunction(name, shaderAware(name, fn))

  let roundWrapper = (fn) => {
    let roundFunc = (args) => {
      let v = argParam(args, 0)
      if (typeof v !== 'number') { v = 0 }
      let to = subParam(args, 'to', subParam(args, 'value1', 1)) // Second positional arg is the precision too, so x>>floor{1/2} works
      return {value:fn(v/to)*to,_finalResult:true} // This is the final result if used in lookup op; do not do a further lookup
    }
    return roundFunc
  }
  addMathsFunction('floor', roundWrapper(Math.floor))
  addMathsFunction('ceil', roundWrapper(Math.ceil))
  addMathsFunction('round', roundWrapper(Math.round))

  let trigWrapper = (fn) => {
    let trigFunc = (args) => {
      let v = argParam(args, 0)
      if (typeof v !== 'number') { v = 0 }
      return {value:fn(v),_finalResult:true} // Final result: no further lookup, so postfix (1).sin is the sine
    }
    return trigFunc
  }
  addMathsFunction('sin', trigWrapper(Math.sin))
  addMathsFunction('cos', trigWrapper(Math.cos))
  addMathsFunction('tan', trigWrapper(Math.tan))
  addMathsFunction('tanh', trigWrapper(Math.tanh))
  add('pi', Math.PI)
  addMathsFunction('abs', trigWrapper(Math.abs))
  addMathsFunction('sgn', trigWrapper(Math.sign))
  addMathsFunction('sign', trigWrapper(Math.sign))
  addMathsFunction('fract', trigWrapper(v => v - Math.floor(v))) // As GLSL fract, so negatives come back positive
  addMathsFunction('sqrt', trigWrapper(Math.sqrt))
  addMathsFunction('exp', trigWrapper(Math.exp))

  // atan{y} is the one argument arctangent; atan{y,x} is atan2, ie the angle of the vector x,y
  let atanFunc = (args) => {
    let v = argParam(args, 0)
    if (typeof v !== 'number') { v = 0 }
    let x = subParam(args, 'x', subParam(args, 'value1', undefined))
    if (typeof x !== 'number') { return {value:Math.atan(v),_finalResult:true} }
    return {value:Math.atan2(v, x),_finalResult:true}
  }
  addMathsFunction('atan', atanFunc)

  // Unlike the ^ operator this does not clamp the base to zero first
  let powFunc = (args) => {
    let v = argParam(args, 0)
    if (typeof v !== 'number') { v = 0 }
    let by = subParam(args, 'by', subParam(args, 'value1', 2)) // Squares by default
    if (typeof by !== 'number') { by = 2 }
    return {value:Math.pow(v, by),_finalResult:true}
  }
  addMathsFunction('pow', powFunc)

  // lo/hi: named, or the second and third positional args
  let rangeOf = (args, loDefault, hiDefault) => {
    let lo = subParam(args, 'lo', subParam(args, 'value1', loDefault))
    let hi = subParam(args, 'hi', subParam(args, 'value2', hiDefault))
    if (typeof lo !== 'number') { lo = loDefault }
    if (typeof hi !== 'number') { hi = hiDefault }
    return [lo, hi]
  }
  let rangeWrapper = (fn) => {
    let rangeFunc = (args) => {
      let v = argParam(args, 0)
      if (typeof v !== 'number') { v = 0 }
      let [lo, hi] = rangeOf(args, 0, 1)
      return {value:fn(v, lo, hi),_finalResult:true}
    }
    return rangeFunc
  }
  addMathsFunction('clamp', rangeWrapper((v, lo, hi) => Math.min(Math.max(v, lo), hi)))
  addMathsFunction('smoothstep', rangeWrapper((v, lo, hi) => {
    if (hi === lo) { return 0 } // Undefined in GLSL too; zero rather than a NaN
    let t = Math.min(Math.max((v-lo)/(hi-lo), 0), 1)
    return t*t*(3-2*t)
  }))

  // Dot product of the rgb components. A plain number counts as all three, so a value means the
  // same thing here as it does in a shader, where everything is a 4 component vector.
  let rgbOf = (v) => {
    while (typeof v === 'object' && v !== null && v.value !== undefined) { v = v.value } // Unwrap units/segment wrappers
    if (typeof v === 'number') { return [v,v,v] }
    if (typeof v === 'object' && v !== null) {
      let c = (a,b) => v[a] !== undefined ? v[a] : (v[b] !== undefined ? v[b] : 0)
      return [c('x','r'), c('y','g'), c('z','b')]
    }
    return [0,0,0]
  }
  let dotFunc = (args) => {
    if (typeof args !== 'object' || args === null) { return {value:0,_finalResult:true} }
    let a = rgbOf(args.value)
    let b = args.value1 !== undefined ? rgbOf(args.value1) : a // One arg dots with itself
    return {value:a[0]*b[0]+a[1]*b[1]+a[2]*b[2],_finalResult:true}
  }
  addMathsFunction('dot', dotFunc)

  // The rest of the vector operations, over rgb as dot is. length collapses to a number; cross and
  // normalize keep their three components, so they come back as a map.
  let lengthOf = (a) => Math.sqrt(a[0]*a[0] + a[1]*a[1] + a[2]*a[2])
  let lengthFunc = (args) => {
    if (typeof args !== 'object' || args === null) { return {value:0,_finalResult:true} }
    return {value:lengthOf(rgbOf(args.value)),_finalResult:true}
  }
  addMathsFunction('length', lengthFunc)
  let normalizeFunc = (args) => {
    if (typeof args !== 'object' || args === null) { return {value:{x:0,y:0,z:0},_finalResult:true} }
    let a = rgbOf(args.value)
    let l = lengthOf(a)
    if (l === 0) { return {value:{x:0,y:0,z:0},_finalResult:true} }
    return {value:{x:a[0]/l, y:a[1]/l, z:a[2]/l},_finalResult:true}
  }
  addMathsFunction('normalize', normalizeFunc)
  let crossFunc = (args) => {
    if (typeof args !== 'object' || args === null) { return {value:{x:0,y:0,z:0},_finalResult:true} }
    let a = rgbOf(args.value)
    let b = args.value1 !== undefined ? rgbOf(args.value1) : a // One arg crosses with itself, ie zero
    return {value:{x:a[1]*b[2]-a[2]*b[1], y:a[2]*b[0]-a[0]*b[2], z:a[0]*b[1]-a[1]*b[0]},_finalResult:true}
  }
  addMathsFunction('cross', crossFunc)

  // pxhash/pxhashf are for visual nodes: a per pixel hash of the value flowing down a px chain,
  // where plain rand would give one number for the whole quad. Off a visual node there is no vector
  // to hash, so they fall back to hashing the number, giving a deterministic value in [0,1) —
  // the same seeding machinery rand itself uses.
  let scalarHash = (args) => {
    let v = argParam(args, 0)
    if (typeof v !== 'number') { v = 0 }
    let seed = subParam(args, 'seed', subParam(args, 'value1', 0)) // Second positional is the seed too
    if (typeof seed !== 'number') { seed = 0 }
    return {value:xmur3(v + seed)/4294967296,_finalResult:true} // Final result: no further lookup, so postfix (3).pxhash works
  }
  addMathsFunction('pxhash', scalarHash)
  addMathsFunction('pxhashf', scalarHash)

  let euclid = (args, e) => {
    let k = Math.floor(argParam(args, 1)) // Distribute k beats...
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
    return dur
  }
  addVarFunction('euclid', euclid)

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
    let r = (args, e,b, fullState) => { // fullState is state per parse instance of the function
      let state = getVoiceState(fullState, e,b)
      let dt = state.dt
      if (dt === 0) { return state.v || 0 }
      let value = (argParam(args, 0) || 0)
      if (typeof value !== 'number') { value = 0 }
      state.v = fn(args, (state.v || 0), value, dt)
      return state.v
    }
    r.interval = 'frame'
    return r
  }

  addVarFunction('accum', statefulWrapper( (args, v, x, dt) => v + Math.max(x,0)*dt ))
  addVarFunction('smooth', statefulWrapper( (args, v, x, dt) => {
    dt = Math.min(dt, 1/30) // Limit dt to prevent excessive large changes when there's a time gap (eg a pattern rest)
    let attDec = subParam(args, 'value1', undefined)
    if (x > v) {
      let att = subParam(args, 'att', attDec) || 8
      return Math.min(v + (x-v)*att*dt, x)
    } else {
      let dec = subParam(args, 'dec', attDec) || 4
      return Math.max(v + (x-v)*dec*dt, x)
    }
  }))
  let rateFunc = (args, e,b, fullState) => {
    let state = getVoiceState(fullState, e,b)
    let dt = state.dt
    if (dt === 0) { return 0 }
    let x = (argParam(args, 0) || 0)
    let last = state.last===undefined ? x : state.last
    let rate = (x - last)/dt
    state.last = x
    return rate || 0
  }
  rateFunc.interval = 'frame'
  addVarFunction('rate', rateFunc)
 
  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual, msg) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`+(msg?'\n'+msg:'')) }
  }
  require('predefined-vars').apply(require('vars').all())
  let parseExpression = require('expression/parse-expression')
  let {evalParamFrame} = require('player/eval-param')
  let ev = (i,c,d,v) => {return{idx:i,count:c,dur:d,_time:c,voice:v}}
  let p

  assert('floor', evalParamFrame(parseExpression('floor'), ev(0,0), 0))
  assert(1, evalParamFrame(parseExpression('floor{1.5}'), ev(0,0), 0))
  assert(-2, evalParamFrame(parseExpression('floor{-1.5}'), ev(0,0), 0))
  assert(1/2, evalParamFrame(parseExpression('floor{0.6,to:1/2}'), ev(0,0), 0))
  assert(-1.5, evalParamFrame(parseExpression('floor{-1.2,to:1/2}'), ev(0,0), 0))

  assert(1, evalParamFrame(parseExpression('floor{[1.5,2.5]t1@e}'), ev(0,0), 0))
  assert(2, evalParamFrame(parseExpression('floor{[1.5,2.5]t1@e}'), ev(1,1), 1))
  assert(1, evalParamFrame(parseExpression('floor{[1.5,2.5]t1@f}'), ev(0,0), 0))
  assert(2, evalParamFrame(parseExpression('floor{[1.5,2.5]t1@f}'), ev(1,1), 1))
  assert([1,2], evalParamFrame(parseExpression('floor{(1.5,2.5)}'), ev(0,0), 0))

  assert(0, evalParamFrame(parseExpression("floor{1.5,2.5}"),ev(0,0,0),0)) // Second positional arg is the precision
  assert(1.5, evalParamFrame(parseExpression("floor{1.7,1/2}"),ev(0,0,0),0))
  assert([1,2], evalParamFrame(parseExpression("floor{(1.5,2.5)}"),ev(0,0,0),0))

  assert(1, evalParamFrame(parseExpression("1.5 .floor"),ev(0,0,0),0))
  assert(1.25, evalParamFrame(parseExpression("(1.3).floor{to:1/4}"),ev(0,0,0),0))

  // >> pipes its left side in as the first argument
  assert(1, evalParamFrame(parseExpression("1.5>>floor"),ev(0,0,0),0))
  assert(1.5, evalParamFrame(parseExpression("1.7>>floor{to:1/2}"),ev(0,0,0),0))
  assert(1.5, evalParamFrame(parseExpression("1.7>>floor{1/2}"),ev(0,0,0),0)) // Piped value takes the first slot
  assert(3, evalParamFrame(parseExpression("(1,2,3)>>max"),ev(0,0,0),0)) // Aggregates, as (1,2,3).max does
  assert(1/2, evalParamFrame(parseExpression("1>>min{1/2}"),ev(0,0,0),0))

  // Trig and friends are the final result too, so a postfix call gives the value not the LHS
  assert(Math.sin(1), evalParamFrame(parseExpression("(1).sin"),ev(0,0,0),0))
  assert(1, evalParamFrame(parseExpression("(-1)>>abs"),ev(0,0,0),0))
  assert(-1, evalParamFrame(parseExpression("(-2)>>sgn"),ev(0,0,0),0))

  // Dot product over rgb; a plain number counts as all three components
  assert(3, evalParamFrame(parseExpression("dot{1,1}"),ev(0,0), 0))
  assert(1/3, evalParamFrame(parseExpression("dot{#f00,1/3}"),ev(0,0), 0))
  assert(1, evalParamFrame(parseExpression("dot{#f00,#ff0}"),ev(0,0), 0))
  assert(0, evalParamFrame(parseExpression("dot{#f00,#0f0}"),ev(0,0), 0))
  assert(3, evalParamFrame(parseExpression("dot{1}"),ev(0,0), 0)) // One arg dots with itself
  assert(1, evalParamFrame(parseExpression("#f00>>dot{#ff0}"),ev(0,0), 0))

  // The rest of the vector functions, over rgb like dot
  assert(Math.sqrt(3), evalParamFrame(parseExpression("length{1}"),ev(0,0), 0)) // A number counts as all three
  assert(1, evalParamFrame(parseExpression("length{#f00}"),ev(0,0), 0))
  assert(5, evalParamFrame(parseExpression("length{{x:3,y:4}}"),ev(0,0), 0))
  assert({x:1,y:0,z:0}, evalParamFrame(parseExpression("normalize{{x:2,y:0,z:0}}"),ev(0,0), 0))
  assert({x:0,y:0,z:0}, evalParamFrame(parseExpression("normalize{0}"),ev(0,0), 0)) // No direction: zero, not a NaN
  assert({x:0,y:0,z:1}, evalParamFrame(parseExpression("cross{{x:1},{y:1}}"),ev(0,0), 0))
  assert({x:0,y:0,z:0}, evalParamFrame(parseExpression("cross{{x:1}}"),ev(0,0), 0)) // One arg crosses with itself

  assert(0.25, evalParamFrame(parseExpression("fract{1.25}"),ev(0,0), 0))
  assert(0.75, evalParamFrame(parseExpression("fract{-1.25}"),ev(0,0), 0)) // As GLSL, not as JS %
  assert(3, evalParamFrame(parseExpression("sqrt{9}"),ev(0,0), 0))
  assert(1, evalParamFrame(parseExpression("exp{0}"),ev(0,0), 0))
  assert(Math.E, evalParamFrame(parseExpression("exp{1}"),ev(0,0), 0))

  assert(9, evalParamFrame(parseExpression("pow{3}"),ev(0,0), 0)) // Squares by default
  assert(8, evalParamFrame(parseExpression("pow{2,3}"),ev(0,0), 0))
  assert(8, evalParamFrame(parseExpression("pow{2,by:3}"),ev(0,0), 0))
  assert(8, evalParamFrame(parseExpression("2>>pow{3}"),ev(0,0), 0))
  assert(-8, evalParamFrame(parseExpression("pow{-2,3}"),ev(0,0), 0)) // No max{,0} on the base, unlike ^

  assert(Math.atan(1), evalParamFrame(parseExpression("atan{1}"),ev(0,0), 0))
  assert(Math.atan2(1,-1), evalParamFrame(parseExpression("atan{1,-1}"),ev(0,0), 0)) // Two args is atan2
  assert(Math.atan2(1,-1), evalParamFrame(parseExpression("atan{1,x:-1}"),ev(0,0), 0))

  assert(1/2, evalParamFrame(parseExpression("clamp{1/2}"),ev(0,0), 0))
  assert(1, evalParamFrame(parseExpression("clamp{2}"),ev(0,0), 0)) // Defaults are 0 to 1
  assert(0, evalParamFrame(parseExpression("clamp{-2}"),ev(0,0), 0))
  assert(2, evalParamFrame(parseExpression("clamp{5,-2,2}"),ev(0,0), 0))
  assert(-2, evalParamFrame(parseExpression("clamp{-5,lo:-2,hi:2}"),ev(0,0), 0))
  assert(2, evalParamFrame(parseExpression("5>>clamp{-2,2}"),ev(0,0), 0))

  assert(0, evalParamFrame(parseExpression("smoothstep{0}"),ev(0,0), 0))
  assert(1/2, evalParamFrame(parseExpression("smoothstep{1/2}"),ev(0,0), 0))
  assert(1, evalParamFrame(parseExpression("smoothstep{1}"),ev(0,0), 0))
  assert(0, evalParamFrame(parseExpression("smoothstep{-1}"),ev(0,0), 0)) // Clamped outside the range
  assert(1, evalParamFrame(parseExpression("smoothstep{2}"),ev(0,0), 0))
  assert(1/2, evalParamFrame(parseExpression("smoothstep{3,2,4}"),ev(0,0), 0))
  assert(1/2, evalParamFrame(parseExpression("smoothstep{3,lo:2,hi:4}"),ev(0,0), 0))

  // pxhash/pxhashf are for visual nodes (see draw/visualsynth/shader-hash.js); off one there is no
  // vector to hash, so they hash the number instead — deterministic, in [0,1), and seedable
  let scalarOf = (src) => evalParamFrame(parseExpression(src), ev(0,0), 0)
  assert(true, scalarOf('pxhash{3}') >= 0 && scalarOf('pxhash{3}') < 1)
  assert(true, scalarOf('pxhash{3}') === scalarOf('pxhash{3}')) // Deterministic: it is a hash, not a random
  assert(true, scalarOf('pxhash{3}') !== scalarOf('pxhash{4}'))
  assert(true, scalarOf('pxhash{3}') !== scalarOf('pxhash{3,seed:1}'))
  assert(true, scalarOf('pxhash{3,seed:1}') === scalarOf('pxhash{3,1}')) // Second positional is the seed too
  assert(true, scalarOf('pxhashf{3}') === scalarOf('pxhash{3}')) // The algorithms only differ in the shader
  assert(true, scalarOf('(3).pxhash') === scalarOf('pxhash{3}')) // Final result, so postfix gives the value
  assert(true, scalarOf('3>>pxhash') === scalarOf('pxhash{3}'))

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
  assert(0.02, evalParamFrame(p, ev(0,0), 1+1/60))
  assert(0.03, evalParamFrame(p, ev(0,0), 1+2/60))

  p = parseExpression('(0,1)+smooth{2}')
  assert([0,1], evalParamFrame(p, ev(0,0,1,0), 1))
  assert([0,1], evalParamFrame(p, ev(0,0,1,1), 1))
  assert([0.27,1.27], evalParamFrame(p, ev(0,0,1,0), 1+1/60))
  assert([0.27,1.27], evalParamFrame(p, ev(0,0,1,1), 1+1/60))

  p = parseExpression('smooth{1,att:1/2,dec:0}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(0.01, evalParamFrame(p, ev(0,0), 1+1/60))
  assert(0.02, evalParamFrame(p, ev(0,0), 1+2/60))

  p = parseExpression('smooth{-1,att:0,dec:1}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(-0.02, evalParamFrame(p, ev(0,0), 1+1/60))
  assert(-0.03, evalParamFrame(p, ev(0,0), 1+2/60))

  assert(0, evalParamFrame(parseExpression('rate{0}'), ev(0,0), 0))

  p = parseExpression('rate{[0:1]l1@f}')
  assert(0, evalParamFrame(p, ev(0,0), 1))
  assert(0, evalParamFrame(p, ev(0,0), 2))
  assert(1, evalParamFrame(p, ev(0,0), 3))
  assert(-1, evalParamFrame(p, ev(0,0), 4))
  assert(1, evalParamFrame(p, ev(0,0), 5))

  let testEuclid = (expected, p) => {
    for (let i=0; i<expected.length; i++) {
      let v = evalParamFrame(p, ev(i,0), 0)
      assert(expected[i], mainParam(v), `Main Index ${i} of expected ${expected}`)
    }
  }
  testEuclid([1], parseExpression('euclid{3}'))
  testEuclid([1], parseExpression('euclid{0,from:0}'))
  testEuclid([1], parseExpression('euclid{1,from:1}'))
  testEuclid([1], parseExpression('euclid{2,from:1}'))

  testEuclid([2], parseExpression('euclid{1,from:2}'))
  testEuclid([2,1], parseExpression('euclid{2,from:3}'))
  testEuclid([2,2], parseExpression('euclid{2,from:4}'))
  testEuclid([3,2,3], parseExpression('euclid{3,from:8}'))
  testEuclid([3,2,3,2,3], parseExpression('euclid{5,from:13}'))

  testEuclid([3,2,3], parseExpression('euclid{3,from:8,offset:0}'))
  testEuclid([3,3,2], parseExpression('euclid{3,from:8,offset:1}'))
  testEuclid([2,3,3], parseExpression('euclid{3,from:8,offset:2}'))
  testEuclid([3,2,3], parseExpression('euclid{3,from:8,offset:3}'))

  console.log('Maths functions tests complete')
  }
})
