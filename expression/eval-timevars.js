'use strict';
define(function(require) {
  let consoleOut = require('console')
  let {piecewise} = require('expression/eval-piecewise')
  let {units} = require('units')

  let step = () => 0
  let linear = (i) => i

  let rangeTimeVar = (vs, ds) => {
    let lo = vs[0] || 0
    let hi = vs[1] || lo+1
    let result = (e,b,evalRecurse) => {
      let elo = evalRecurse(lo, e,b)
      let ehi = evalRecurse(hi, e,b)
      if (!Number.isInteger(elo)) { consoleOut(`🟠 Warning: Time var low value ${elo} is not an integer`) }
      if (!Number.isInteger(ehi)) { consoleOut(`🟠 Warning: Time var high value ${ehi} is not an integer`) }
      let vs = Array.from({length: ehi-elo+1}, (_, i) => i + elo)
      if (!Array.isArray(ds)) { ds = [ds] }
      let is = vs.map(() => step)
      let ss = vs.map((_,i) => ds[i % ds.length])
      return piecewise(vs, is, ss, (e,b) => b)
    }
    return result
  }

  let timeVar = (vs, is, ss, ds, defaultI) => {
    if (!Array.isArray(ds)) { ds = [ds] }
    is = is.map(i => i || defaultI)
    ss = ss.map((s,idx) => s!==undefined ? s : ds[idx % ds.length])
    return piecewise(vs, is, ss, (e,b) => b)
  }

  let eventTimeVar = (vs, is, ss, ds) => {
    if (vs.length === 0) { return piecewise([]) }
    if (vs.length === 1) { return piecewise(vs, [step], [1], ()=>0) }
    let haveAnySs = ss.reduce((a, s) => a||(s!==undefined), false)
    if (ds === undefined && !haveAnySs) { // If no durations set, space out evenly through the event
      is = is.map(i => i || linear)
      ss = ss.map(s => s!==undefined ? s : 1)
      is[is.length-1] = step // Last one is final value, not part of the event
      ss[ss.length-1] = 0
      let total = ss.reduce((a,x) => a+x, 0)
      ss = ss.map(s => s/total) // Normalise sizes
      let p = (e,b) => {
        if (!e.countToTime) { return 0 }
        return Math.min((e.countToTime(b) - e._time) / (e.endTime - e._time), 0.999999) // Hold at final value, don't keep repeating
      }
      return piecewise(vs, is, ss, p)
    } else { // Use durations provided
      if (!Array.isArray(ds)) { ds = [ds || 1] }
      is = is.map(i => i || linear)
      ss = ss.map(s => units(s, 'b')) // Default to beats but accept s etc. Should not be parse time this gets evalled at though!
      ss = ss.map((s,idx) => s!==undefined ? s : ds[idx % ds.length])
      is[is.length-1] = step // Last one is final value, not part of the event
      let totalDuration = ss.reduce((a,x) => a+x, 0)
      let p = (e,b) => {
        if (!e.countToTime) { return 0 }
        return Math.min(e.countToTime(b) - e._time, totalDuration-0.000001)
      }
      return piecewise(vs, is, ss, p)
    }
  }

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  
    let assert = (expected, actual, msg) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`+(msg?'\n'+msg:'')) }
    }
    let ev = (c,d,i) => {return{idx:i||0, count:c||0, dur:d||1, _time:c, endTime:c+d, countToTime:x=>x}}
    let ev120 = (c,d) => {return{idx:0, count:c, dur:d, _time:c/2, endTime:c/2+d/2, countToTime:(count) => c*0.5 + (count-c)*0.5}}
    let {evalParamFrame} = require('player/eval-param')
    let u2=[undefined,undefined]
    let u3=[undefined,undefined,undefined]

    assert(1, evalParamFrame(eventTimeVar([1,2],u2,u2),ev(0,1), 0))
    assert(1.5, evalParamFrame(eventTimeVar([1,2],u2,u2),ev(0,1), 0.5))
    assert(2, evalParamFrame(eventTimeVar([1,2],u2,u2),ev(0,1), 1))
    assert(2, evalParamFrame(eventTimeVar([1,2],u2,u2),ev(0,1), 2))

    assert(1, evalParamFrame(eventTimeVar([1,2],u2,u2),ev120(0,1), 0))
    assert(1.5, evalParamFrame(eventTimeVar([1,2],u2,u2),ev120(0,1), 0.5))
    assert(2, evalParamFrame(eventTimeVar([1,2],u2,u2),ev120(0,1), 1))
    assert(2, evalParamFrame(eventTimeVar([1,2],u2,u2),ev120(0,1), 2))

    assert(1, evalParamFrame(eventTimeVar([1,2],u2,u2),ev(10,2), 0))
    assert(9/8, evalParamFrame(eventTimeVar([1,2],u2,u2),ev(10,2), 1/4))
    assert(1.5, evalParamFrame(eventTimeVar([1,2],u2,u2),ev(10,2), 1))
    assert(1, evalParamFrame(eventTimeVar([1,2],u2,u2),ev(10,2), 2))
    assert(1, evalParamFrame(eventTimeVar([1,2],u2,u2),ev(10,2), 8))
    assert(1.5, evalParamFrame(eventTimeVar([1,2],u2,u2),ev(10,2), 9))
    assert(1, evalParamFrame(eventTimeVar([1,2],u2,u2),ev(10,2), 10))
    assert(1.5, evalParamFrame(eventTimeVar([1,2],u2,u2),ev(10,2), 11))
    assert(2, evalParamFrame(eventTimeVar([1,2],u2,u2),ev(10,2), 12))
    assert(2, evalParamFrame(eventTimeVar([1,2],u2,u2),ev(10,2), 13))

    assert(1, evalParamFrame(eventTimeVar([1,2],u2,u2),ev120(10,2), 0))
    assert(9/8, evalParamFrame(eventTimeVar([1,2],u2,u2),ev120(10,2), 1/4))
    assert(1.5, evalParamFrame(eventTimeVar([1,2],u2,u2),ev120(10,2), 1))
    assert(1, evalParamFrame(eventTimeVar([1,2],u2,u2),ev120(10,2), 2))
    assert(1, evalParamFrame(eventTimeVar([1,2],u2,u2),ev120(10,2), 8))
    assert(1.5, evalParamFrame(eventTimeVar([1,2],u2,u2),ev120(10,2), 9))
    assert(1, evalParamFrame(eventTimeVar([1,2],u2,u2),ev120(10,2), 10))
    assert(1.5, evalParamFrame(eventTimeVar([1,2],u2,u2),ev120(10,2), 11))
    assert(2, evalParamFrame(eventTimeVar([1,2],u2,u2),ev120(10,2), 12))
    assert(2, evalParamFrame(eventTimeVar([1,2],u2,u2),ev120(10,2), 13))

    assert(1, evalParamFrame(eventTimeVar([1,2,3],u3,u3),ev(0,1), 0))
    assert(1.5, evalParamFrame(eventTimeVar([1,2,3],u3,u3),ev(0,1), 0.25))
    assert(2, evalParamFrame(eventTimeVar([1,2,3],u3,u3),ev(0,1), 0.5))
    assert(2.5, evalParamFrame(eventTimeVar([1,2,3],u3,u3),ev(0,1), 0.75))
    assert(3, evalParamFrame(eventTimeVar([1,2,3],u3,u3),ev(0,1), 1))

    console.log('Eval timevar tests complete')
  }

  return {
    timeVar: timeVar,
    rangeTimeVar: rangeTimeVar,
    eventTimeVar: eventTimeVar,
  }
})