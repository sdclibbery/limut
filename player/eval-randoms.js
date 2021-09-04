'use strict';
define(function(require) {
  let evalOperator = require('player/eval-operator')
  let param = require('player/default-param')

  function xmur3(time, seed) {
    let h = 1779033703
    h = Math.imul(h ^ Math.floor(seed), 3432918353)
    h = h << 13 | h >>> 19
    h = Math.imul(h ^ Math.floor(time), 3432918353)
    h = h << 13 | h >>> 19
    h = Math.imul(h ^ Math.floor((time%1)*4294967296), 3432918353)
    h = h << 13 | h >>> 19
    h = Math.imul(h ^ h >>> 16, 2246822507)
    h = Math.imul(h ^ h >>> 13, 3266489909)
    return (h ^= h >>> 16) >>> 0
  }

  let add = (a,b) => a+b
  let mul = (a,b) => a*b
  let lerpValue = (lerp, pre, post) => {
    return evalOperator(add,
      evalOperator(mul, 1-lerp, pre),
      evalOperator(mul, lerp, post)
    )
  }

  let evalRandomRanged = (generator, lo, hi, e, b) => {
    return lerpValue(generator(e,b), lo, hi)
  }

  let evalRandomSet = (generator, vs, e, b) => {
    let idx = Math.floor(generator(e,b)*vs.length*0.9999)
    return vs[idx]
  }

  let periodicRandom = (getter, period, interval) => {
    let lastBeat, lastValue
    return (e,b,evalRecurse) => {
      let count = (interval !== 'frame') ? e.count : b
      if (lastValue === undefined || period === undefined || count >= lastBeat+period-0.0001) {
        lastBeat = count
        lastValue = getter(e,b,evalRecurse)
      }
      return lastValue
    }
  }

  let random = (getter) => {
    let events = new WeakMap()
    return (e,b,evalRecurse) => {
      if (!events.has(e)) {
        events.set(e, getter(e,b,evalRecurse))
      }
      return evalRecurse(events.get(e), e,b, evalRecurse)
    }
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
  let simpleNoise = (vs, period, interval) => {
    let paramSeed = Math.random()*10000
    return (e,b, evalRecurse) => {
      let count = (interval !== 'frame') ? e.count : b
      count += paramSeed
      let result = (
          bnoise(count*1/period)*2
          +(1-bnoise(count*2.3/period))*1
        )/3
      let evs = vs.map(v => evalRecurse(v, e,b, evalRecurse))
      if (evs.length >= 2) {
        let lo = evs[0]
        let hi = evs[evs.length-1]
        result = lerpValue(result, lo, hi)
      }
      return result
    }
  }

  let parseRandom = (vs, period, config, interval) => {
    let evaluator
    let generator = () => Math.random()
    if (config && config.seed !== undefined) {
      generator = (e,b) => xmur3(e.count % (config.reset || 4294967296), config.seed) / 4294967296
    }
    if (vs.length == 0) {
      evaluator = (e,b,evalRecurse) => evalRandomRanged(generator, 0, 1, e, b)
    } else if (vs.separator == ':') {
      let lo = param(vs[0], 0)
      let hi = param(vs[1], 1)
      evaluator = (e,b,evalRecurse) => evalRandomRanged(generator, evalRecurse(lo,e,b,evalRecurse), evalRecurse(hi,e,b,evalRecurse), e, b)
    } else {
      evaluator = (e,b,evalRecurse) => evalRecurse(evalRandomSet(generator, vs, e, b),e,b,evalRecurse)
    }
    if (period) {
      return periodicRandom(evaluator, period, interval)
    } else {
      return random(evaluator)
    }
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      if (expected !== actual) { console.trace(`Assertion failed.\n>>Expected equal:\n  ${expected}\n>>Actual:\n  ${actual}`) }
    }
    let assertNotEqual = (expected, actual) => {
      if (expected === actual) { console.trace(`Assertion failed.\n>>Expected unequal:\n  ${expected}\n>>Actual:\n  ${actual}`) }
    }
    let assertIs1OfEveryTime = (expected, getter) => {
      for (let i=0; i<20; i++) {
        let r = getter()
        if (!expected.includes(r)) { console.trace(`Assertion failed.\n>>Expected one of:\n  ${expected}\n>>Actual:\n  ${r}`) }
      }
    }
    let assertIsInRangeEveryTime = (lo, hi, getter) => {
      for (let i=0; i<20; i++) {
        let r = getter()
        if (r<lo || r>hi) { console.trace(`Assertion failed.\n>>Expected in range:\n  ${lo} - ${hi}\n>>Actual:\n  ${r}`) }
      }
    }
    let assertIsSameEveryTime = (getter) => {
      let x = getter()
      for (let i=0; i<20; i++) {
        assert(x, getter())
      }
    }
    let evalParam = require('player/eval-param').evalParamFrame
    let ev = (c) => {return{count:c}}
    let p, vs

    p = parseRandom([3,5])
    assertIs1OfEveryTime([3,5], () => evalParam(p,ev(0),0))

    p = parseRandom([])
    assertIsInRangeEveryTime(0,1, () => evalParam(p,ev(0),0))

    vs = [3,5]
    vs.separator = ':'
    p = parseRandom(vs)
    assertIsInRangeEveryTime(3,5, () => evalParam(p,ev(0),0))

    // Always gives same value at same time when periodic, even when not seeded
    p = parseRandom([3,5], 1)
    assertIsSameEveryTime(() => evalParam(p,ev(0),0))
    assertIsSameEveryTime(() => evalParam(p,ev(1),1))

    // Non fixed value when not seeded
    p = parseRandom([], undefined, {})
    assertNotEqual(0.6270739405881613, evalParam(p,ev(0),0))

    // Same sequence every time when seeded
    p = parseRandom([], undefined, {seed:1})
    assert(0.28334228484891355, evalParam(p,ev(0),0))
    assert(0.7462359906639904, evalParam(p,ev(1/4),1/4))
    assert(0.3572767286095768, evalParam(p,ev(1/2),1/2))
    assert(0.9428444323129952, evalParam(p,ev(3/4),3/4))
    assert(0.6775630139745772, evalParam(p,ev(1),1))
    assert(0.7935523670166731, evalParam(p,ev(2),2))
    assert(0.6304690549150109, evalParam(p,ev(3),3))
    assert(0.5204362396616489, evalParam(p,ev(4),4))

    // // Reset seed on every reset'th beat
    // p = parseRandom([], undefined, {seed:1,reset:3})
    // assert(0.28334228484891355, evalParam(p,ev(0),0))
    // assert(0.6775630139745772, evalParam(p,ev(1),1))
    // assert(0.7935523670166731, evalParam(p,ev(2),2))
    // assert(0.9810509674716741, evalParam(p,ev(2),2))
    // assert(0.28334228484891355, evalParam(p,ev(3),3))
    // assert(0.6775630139745772, evalParam(p,ev(3),3))
    // assert(0.7935523670166731, evalParam(p,ev(3),3))
    // assert(0.28334228484891355, evalParam(p,ev(6),6))

    console.log('Eval random tests complete')
  }

  return {
    parseRandom: parseRandom,
    simpleNoise: simpleNoise,
  }
})