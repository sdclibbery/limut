'use strict';
define(function(require) {

  let evalRandomRanged = (lo, hi) => {
    return lo + Math.random() * (hi-lo)
  }

  let evalRandomSet = (vs, e,b, evalRecurse) => {
    let idx = Math.floor(Math.random()*vs.length*0.9999)
    return evalRecurse(vs[idx], e,b)
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
      return events.get(e)
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
      if (vs.separator === ':' && evs.length === 2) {
        let lo = evs[0]
        let hi = evs[1]
        result = lo + result*(hi-lo)
      }
      return result
    }
  }

  return {
    evalRandomRanged: evalRandomRanged,
    evalRandomSet: evalRandomSet,
    periodicRandom: periodicRandom,
    random: random,
    simpleNoise: simpleNoise,
  }
})