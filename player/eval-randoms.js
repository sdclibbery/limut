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
      let count = (interval !== 'frame') ? b = e.count : b
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

  return {
    evalRandomRanged: evalRandomRanged,
    evalRandomSet: evalRandomSet,
    periodicRandom: periodicRandom,
    random: random,
  }
})