'use strict';
define(function(require) {
  let evalOperator = require('player/eval-operator')
  let param = require('player/default-param')

  function xmur3(seed) {
    let h = 1779033703
    h = Math.imul(h ^ Math.floor(seed), 3432918353)
    h = h << 13 | h >>> 19
    h = Math.imul(h ^ Math.floor((seed%1)*4294967296), 3432918353)
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

  let evalRandomRanged = (generator, lo, hi, e, b, evalRecurse) => {
    return lerpValue(generator(e,b,evalRecurse), lo, hi)
  }

  let evalRandomSet = (generator, vs, e, b, evalRecurse) => {
    let idx = Math.floor(generator(e,b,evalRecurse)*vs.length*0.9999)
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

  let random = (getter, interval) => {
    let events
    return (e,b,evalRecurse) => {
      if (interval === 'frame') {
        return evalRecurse(getter(e,b,evalRecurse), e,b, evalRecurse)
      }
      if (!events) { events = new WeakMap() }
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
  let simpleNoise = (vs, period, config, interval) => {
    let ps = Math.random()*10000
    let generator = (e,b,evalRecurse) => {
      return ((interval !== 'frame') ? e.count : b) + ps
    }
    if (config && config.seed !== undefined) {
      generator = (e,b,evalRecurse) => {
        let per = evalRecurse(config.per,e,b,evalRecurse) || 4294967296
        let count = (interval !== 'frame') ? e.count : b
        let seed = (count % per) - evalRecurse(config.seed,e,b,evalRecurse)
        return xmur3(seed) / 4294967296
      }
    }
    return (e,b, evalRecurse) => {
      let value = generator(e,b,evalRecurse)
      let result = (
          bnoise(value*1/period)*2
          +(1-bnoise(value*2.3/period))*1
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
      generator = (e,b,evalRecurse) => {
        let per = evalRecurse(config.per,e,b,evalRecurse) || 4294967296
        let count = (interval !== 'frame') ? e.count : b
        let seed = (count % per) - evalRecurse(config.seed,e,b,evalRecurse)
        return xmur3(seed) / 4294967296
      }
    }
    if (vs.length == 0) {
      evaluator = (e,b,evalRecurse) => evalRandomRanged(generator, 0, 1, e, b, evalRecurse)
    } else if (vs.separator == ':') {
      let lo = param(vs[0], 0)
      let hi = param(vs[1], 1)
      evaluator = (e,b,evalRecurse) => evalRandomRanged(generator, evalRecurse(lo,e,b,evalRecurse), evalRecurse(hi,e,b,evalRecurse), e, b, evalRecurse)
    } else {
      evaluator = (e,b,evalRecurse) => evalRecurse(evalRandomSet(generator, vs, e, b, evalRecurse),e,b,evalRecurse)
    }
    if (period) {
      return periodicRandom(evaluator, period, interval)
    } else {
      return random(evaluator, interval)
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
        let r = getter(i)
        if (!expected.includes(r)) { console.trace(`Assertion failed.\n>>Expected one of:\n  ${expected}\n>>Actual:\n  ${r}`) }
      }
    }
    let assertIsInRangeEveryTime = (lo, hi, getter) => {
      for (let i=0; i<20; i++) {
        let r = getter(i)
        if (r === undefined || isNaN(r) || r<lo || r>hi) { console.trace(`Assertion failed.\n>>Expected in range:\n  ${lo} - ${hi}\n>>Actual:\n  ${r}`) }
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
    let p, vs, r

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
    assertNotEqual(0.3853306171949953, evalParam(p,ev(0),0))

    // Same sequence every time when seeded
    p = parseRandom([], undefined, {seed:1})
    assert(0.3853306171949953, evalParam(p,ev(0),0))
    assert(0.5050126616843045, evalParam(p,ev(1/4),1/4))
    assert(0.6197433876805007, evalParam(p,ev(1/2),1/2))
    assert(0.8054445369634777, evalParam(p,ev(3/4),3/4))
    assert(0.8534541970584542, evalParam(p,ev(1),1))
    assert(0.35433487710542977, evalParam(p,ev(2),2))
    assert(0.08498840616084635, evalParam(p,ev(3),3))
    assert(0.8467781520448625, evalParam(p,ev(4),4))

    // Reset seed on every reset'th beat
    p = parseRandom([], undefined, {seed:1,per:3})
    assert(0.3853306171949953, evalParam(p,ev(0),0))
    assert(0.8534541970584542, evalParam(p,ev(1),1))
    assert(0.35433487710542977, evalParam(p,ev(2),2))
    assert(0.35433487710542977, evalParam(p,ev(2),2))
    assert(0.3853306171949953, evalParam(p,ev(3),3))
    assert(0.3853306171949953, evalParam(p,ev(3),3))
    assert(0.3853306171949953, evalParam(p,ev(3),3))
    assert(0.8534541970584542, evalParam(p,ev(4),4))
    assert(0.3853306171949953, evalParam(p,ev(6),6))

    // Shifted sequence when bump seed
    p = parseRandom([], undefined, {seed:1})
    assert(0.3853306171949953, evalParam(p,ev(0),0))
    assert(0.8534541970584542, evalParam(p,ev(1),1))
    assert(0.35433487710542977, evalParam(p,ev(2),2))
    assert(0.08498840616084635, evalParam(p,ev(3),3))
    p = parseRandom([], undefined, {seed:2})
    assert(0.3672695131972432, evalParam(p,ev(0),0))
    assert(0.3853306171949953, evalParam(p,ev(1),1))
    assert(0.8534541970584542, evalParam(p,ev(2),2))
    assert(0.35433487710542977, evalParam(p,ev(3),3))

    p = parseRandom([], undefined, {seed:0})
    assertIsInRangeEveryTime(0,1, () => evalParam(p,ev(0),0))

    p = parseRandom([], undefined, {seed:-100})
    assertIsInRangeEveryTime(0,1, () => evalParam(p,ev(0),0))

    p = parseRandom([], undefined, {seed:()=>1,per:()=>3})
    assert(0.3853306171949953, evalParam(p,ev(0),0))
    assert(0.3853306171949953, evalParam(p,ev(3),3))

    // []r should give a new value for each event
    let testEvent = ev(0,0)
    p = parseRandom([], undefined, undefined, undefined)
    r = p(testEvent,0,evalParam)
    assertIs1OfEveryTime([r], (i)=>p(testEvent,i/10,evalParam))
    assertNotEqual(r, p(ev(0,0),0,evalParam)) // different value for new event

    p = simpleNoise([], 1)
    assertIsInRangeEveryTime(0,1, () => evalParam(p,ev(0),0))

    p = simpleNoise([3,5], 1)
    assertIsInRangeEveryTime(3,5, () => evalParam(p,ev(0),0))

    // Same sequence every time when seeded
    p = simpleNoise([], 1, {seed:1})
    assert(0.8426829859122709, evalParam(p,ev(0),0))
    assert(0.9005707556884941, evalParam(p,ev(1/4),1/4))
    assert(0.5210828635247373, evalParam(p,ev(1),1))

    // Reset seed on every reset'th beat
    p = simpleNoise([], 1, {seed:1,per:3})
    assert(0.8426829859122709, evalParam(p,ev(0),0))
    assert(0.5210828635247373, evalParam(p,ev(1),1))
    assert(0.7448183519247357, evalParam(p,ev(2),2))
    assert(0.7448183519247357, evalParam(p,ev(2),2))
    assert(0.8426829859122709, evalParam(p,ev(3),3))

    console.log('Eval random tests complete')
  }

  return {
    parseRandom: parseRandom,
    simpleNoise: simpleNoise,
  }
})