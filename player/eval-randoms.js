'use strict';
define(function(require) {

  let evalRandomRanged = (lo, hi) => {
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
      return lo + Math.random() * (hi-lo)
    } else {
      return lo + Math.floor(Math.random() * (hi-lo+0.9999))
    }
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
    return ((n*n*n*n)%951.135664)/951.135664
  }
  let bnoise = (x) => {
      let i = Math.trunc(x)
      let f = x%1
      let s = Math.sign((x/2.0)%1-0.5)
      let k = hash(i)
      return s*f*(f-1.0)*((16.0*k-4.0)*f*(f-1.0)-1.0)
  }
  let simpleNoise = (vs, interval) => {
    let paramSeed = Math.random()*10000
    return (e,b, evalRecurse) => {
      if (e._noiseSeed === undefined) { e._noiseSeed = Math.random()*10000 }
      let count = (interval !== 'frame') ? e.count : b
      count += e._noiseSeed + paramSeed
      let result = (
          bnoise(count*1)*4
          +bnoise(count*2)*2
          +bnoise(count*4)*1
        )*3/14
      return result
    }
  }

  console.log('Random tests complete')

  return {
    evalRandomRanged: evalRandomRanged,
    evalRandomSet: evalRandomSet,
    periodicRandom: periodicRandom,
    random: random,
    simpleNoise: simpleNoise,
  }
})