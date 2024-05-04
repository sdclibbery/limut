'use strict';
define(function(require) {
  let evalOperator = require('expression/eval-operator')
  let param = require('player/default-param')
  let randFunction = require('functions/rand')
  let {piecewise} = require('expression/eval-piecewise')
  let {units} = require('units')

  let step = () => 0
  let linear = (i) => i

  let parseRangedRandom = (vs, is, ss) => {
    let state = {} // Create a state store for this parse instance
    let lo = param(vs[0], 0)
    let hi = param(vs[1], 1)
    let p = (e,b,er,m) => randFunction(m, e, b, state)
    return piecewise([lo, hi], [linear, step], [1,0], p, {})
  }

  let parseRandom = (vs, is, ss) => {
    let state = {} // Create a state store for this parse instance
    if (vs.length == 0) { // Default to random between 0 and 1
      return (e,b,er,m) => randFunction(m, e, b, state)
    } else { // Choose from a list
      is = is.map(i => i || step)
      ss = ss.map(s => s!==undefined ? s : 1)
      let total = ss.reduce((a, x) => a + x, 0)
      ss = ss.map(s => s/total) // Normalise sizes
      let p = (e,b,er,m) => randFunction(m, e, b, state)
      return piecewise(vs, is, ss, p, {})
    }
  }

  let add = (a,b) => a+b
  let mul = (a,b) => a*b
  let lerpValue = (lerp, pre, post) => {
    return evalOperator(add,
      evalOperator(mul, 1-lerp, pre),
      evalOperator(mul, lerp, post)
    )
  }

  let hash = (n) => {
    n += 213.43254
    n *= n
    let r = ((n*n*n*n)%951.135664)/951.135664
    return r
  }
  let bnoise = (x) => {
    let i = Math.trunc(x)
    let f = x%1
    let k = hash(i)
    let r = f*(f-1.0)*((16.0*k-4.0)*f*(f-1.0)-1.0)
    return r
  }
  let simpleNoise = (vs, period) => {
    let seed = Math.random()*10000
    return (e,b, evalRecurse, modifiers) => {
      if (modifiers && modifiers.seed !== undefined) {
        seed = units(modifiers.seed, 'b')
      }
      period = units(period, 'b')
      let value = b + seed
      let result = (
          bnoise(value*1/period)*2
          +(1-bnoise(value*2.3/period))*1
        )/3
      let evs = vs.map(v => evalRecurse(v, e,b))
      if (evs.length >= 2) {
        let lo = evs[0]
        let hi = evs[evs.length-1]
        result = lerpValue(result, lo, hi)
      }
      return result
    }
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual, msg) => {
      if (expected !== actual) { console.trace(`Assertion failed ${msg}.\n>>Expected equal:\n  ${expected}\n>>Actual:\n  ${actual}`) }
    }
    let assertNotEqual = (expected, actual, msg) => {
      if (expected === actual) { console.trace(`Assertion failed ${msg}.\n>>Expected unequal:\n  ${expected}\n>>Actual:\n  ${actual}`) }
    }
    let assertIs1OfEveryTime = (expected, getter) => {
      for (let i=0; i<20; i++) {
        let r = getter(i)
        if (!expected.includes(r)) { console.trace(`Assertion failed index ${i}.\n>>Expected one of:\n  ${expected}\n>>Actual:\n  ${r}`) }
      }
    }
    let assertIsInRangeEveryTime = (lo, hi, getter) => {
      for (let i=0; i<20; i++) {
        let r = getter(i)
        if (r === undefined || isNaN(r) || r<lo || r>hi) { console.trace(`Assertion failed index ${i}.\n>>Expected in range:\n  ${lo} - ${hi}\n>>Actual:\n  ${r}`) }
      }
    }
    let assertIsDifferentEveryTime = (getter) => {
      let old = getter(0)
      for (let i=1; i<=20; i++) {
        let next = getter(i)
        assertNotEqual(old, next, `Index: ${i}`)
        old = next
      }
    }
    let assertIsCloseEveryTime = (getter) => {
      let last = getter(0)
      for (let i=1; i<=20; i++) {
        let v = getter(i)
        if (Math.abs(v-last) > 0.1) { console.trace(`Assertion failed index ${i}.\n>>Expected ${v} to be close to ${last}`) }
        last = v
      }
    }
    let {evalParamFrame} = require('player/eval-param')
    let ev = (c) => {return{count:c}}
    let p, r

    p = parseRandom([], [], [])
    assertIsInRangeEveryTime(0,1, () => evalParamFrame(p,ev(0),0))
    
    p = parseRandom([3,5], [undefined,undefined], [undefined,undefined])
    assertIs1OfEveryTime([3,5], () => evalParamFrame(p,ev(0),0))

    p = parseRangedRandom([3,5], [undefined,undefined], [undefined,undefined])
    assertIsInRangeEveryTime(3,5, () => evalParamFrame(p,ev(0),0))

    p = parseRangedRandom([5,3], [undefined,undefined], [undefined,undefined])
    assertIsInRangeEveryTime(3,5, () => evalParamFrame(p,ev(0),0))

    p = parseRangedRandom([3], [undefined], [undefined])
    assertIsInRangeEveryTime(0,3, () => evalParamFrame(p,ev(0),0))

    // Give correct value even when evalled out of time order
    p = parseRangedRandom([-1,1], 1/4)
    evalParamFrame(p,ev(1),1) // equivalent to a later event being evalled per event
    assertIsDifferentEveryTime((i) => evalParamFrame(p,ev(i/4),i/4))

    // Non fixed value when not seeded
    p = parseRandom([], [], [])
    assertNotEqual(0.3853306171949953, evalParamFrame(p,ev(0),0))

    // Same sequence every time when seeded
    p = parseRandom([], [], [])
    p.modifiers = {seed:1}
    assert(0.3853306171949953, evalParamFrame(p,ev(0),0))
    assert(0.5050126616843045, evalParamFrame(p,ev(1/4),1/4))
    assert(0.6197433876805007, evalParamFrame(p,ev(1/2),1/2))
    assert(0.8054445369634777, evalParamFrame(p,ev(3/4),3/4))
    assert(0.8534541970584542, evalParamFrame(p,ev(1),1))
    assert(0.35433487710542977, evalParamFrame(p,ev(2),2))
    assert(0.08498840616084635, evalParamFrame(p,ev(3),3))
    assert(0.8467781520448625, evalParamFrame(p,ev(4),4))

    // Shifted sequence when bump seed
    p = parseRandom([], [], [])
    p.modifiers = {seed:1}
    assert(0.3853306171949953, evalParamFrame(p,ev(0),0))
    assert(0.8534541970584542, evalParamFrame(p,ev(1),1))
    assert(0.35433487710542977, evalParamFrame(p,ev(2),2))
    assert(0.08498840616084635, evalParamFrame(p,ev(3),3))
    p = parseRandom([], [], [])
    p.modifiers = {seed:2}
    assert(0.3672695131972432, evalParamFrame(p,ev(0),0))
    assert(0.3853306171949953, evalParamFrame(p,ev(1),1))
    assert(0.8534541970584542, evalParamFrame(p,ev(2),2))
    assert(0.35433487710542977, evalParamFrame(p,ev(3),3))

    p = parseRandom([], [], [])
    p.modifiers = {seed:0}
    assertIsInRangeEveryTime(0,1, () => evalParamFrame(p,ev(0),0))

    p = parseRandom([], [], [])
    p.modifiers = {seed:-100}
    assertIsInRangeEveryTime(0,1, () => evalParamFrame(p,ev(0),0))

    p = simpleNoise([], 1)
    assertIsInRangeEveryTime(0,1, () => evalParamFrame(p,ev(0),0))

    p = simpleNoise([3,5], 1)
    assertIsInRangeEveryTime(3,5, () => evalParamFrame(p,ev(0),0))

    // Same sequence every time when seeded
    p = simpleNoise([], 1)
    p.modifiers = {seed:1}
    assert(0.1989616905192142, evalParamFrame(p,ev(0),0))
    assert(0.503624927728974, evalParamFrame(p,ev(1/4),1/4))
    assert(0.3226893881270972, evalParamFrame(p,ev(1),1))

    //Noise should be smooth
    p = simpleNoise([], 4)
    assertIsCloseEveryTime((i)=>p(ev(i/20),i/20,evalParamFrame))

    p = simpleNoise([], 4)
    p.modifiers = {seed:1}
    assertIsCloseEveryTime((i)=>p(ev(i/11),i/11,evalParamFrame))

    console.log('Eval random tests complete')
  }

  return {
    parseRandom: parseRandom,
    parseRangedRandom: parseRangedRandom,
    simpleNoise: simpleNoise,
  }
})