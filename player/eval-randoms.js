'use strict';
define(function(require) {
  let evalOperator = require('player/eval-operator')
  let param = require('player/default-param')

  let evalRandomRanged = (lo, hi) => {
    return lo + Math.random() * (hi-lo)
  }

  let evalRandomSet = (vs) => {
    let idx = Math.floor(Math.random()*vs.length*0.9999)
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

  let parseRandom = (vs, period, interval) => {
    let rand
    if (vs.length == 0) {
      rand = (e,b,evalRecurse) => evalRandomRanged(0.000001, 1)
    } else if (vs.separator == ':') {
      let lo = param(vs[0], 0)
      let hi = param(vs[1], 1)
      rand = (e,b,evalRecurse) => evalRandomRanged(evalRecurse(lo,e,b,evalRecurse), evalRecurse(hi,e,b,evalRecurse))
    } else {
      rand = (e,b,evalRecurse) => evalRandomSet(vs)
    }
    if (period) {
      return periodicRandom(rand, period, interval)
    } else {
      return random(rand)
    }
  }

  return {
    parseRandom: parseRandom,
    simpleNoise: simpleNoise,
  }
})