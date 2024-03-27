'use strict';
define(function(require) {
  let evalOperator = require('expression/eval-operator')
  let consoleOut = require('console')
  let {piecewise} = require('expression/eval-piecewise')

  let step = () => 0
  let linear = (i) => i
  let smooth = (i) => i*i*(3-2*i) // bezier ease in/out

  let time = (e,b) => b
  let idx = (e,b) => Math.floor(e.idx || 0)

  let rangeTimeVar = (vs, ds) => {
    let lo = vs[0] || 0
    let hi = vs[1] || lo+1
    return (e,b,evalRecurse) => {
      let elo = evalRecurse(lo, e,b)
      let ehi = evalRecurse(hi, e,b)
      if (!Number.isInteger(elo)) { consoleOut(`🟠 Warning: Time var low value ${elo} is not an integer`) }
      if (!Number.isInteger(ehi)) { consoleOut(`🟠 Warning: Time var high value ${ehi} is not an integer`) }
      let vs = Array.from({length: ehi-elo+1}, (_, i) => i + elo)
      if (!Array.isArray(ds)) { ds = [ds] }
      let is = vs.map(() => step)
      let ss = vs.map((_,i) => ds[i % ds.length])
      return piecewise(vs, is, ss, time)
    }
  }

  let timeVar = (vs, ds) => {
    if (vs.separator == ':') {
      return rangeTimeVar(vs, ds)
    }
    if (!Array.isArray(ds)) { ds = [ds] }
    let is = vs.map(() => step)
    let ss = vs.map((_,i) => ds[i % ds.length])
    return piecewise(vs, is, ss, time)
  }

  let linearTimeVar = (vs, ds) => {
    if (!Array.isArray(ds)) { ds = [ds] }
    let is = vs.map(() => linear)
    let ss = vs.map((_,i) => ds[i % ds.length])
    return piecewise(vs, is, ss, time)
  }

  let smoothTimeVar = (vs, ds) => {
    if (!Array.isArray(ds)) { ds = [ds] }
    let is = vs.map(() => smooth)
    let ss = vs.map((_,i) => ds[i % ds.length])
    return piecewise(vs, is, ss, time)
  }

  let eventTimeVar = (vs, ds) => {
    if (vs.length === 0) { return () => 0 }
    if (vs.length === 1) { return () => vs[0] }
    if (ds === undefined) { // If no durations set, space out evenly through the event
      let is = vs.map(() => linear)
      let ss = vs.map(() => 1/(vs.length-1))
      is[is.length-1] = step // Last one is final value, not part of the event
      ss[ss.length-1] = 0
      let p = (e,b) => {
        if (!e.countToTime) { return 0 }
        return Math.min((e.countToTime(b) - e._time) / (e.endTime - e._time), 0.999999) // Hold at final value, don't keep repeating
      }
      return piecewise(vs, is, ss, p)
    } else { // Use durations provided
      if (!Array.isArray(ds)) { ds = [ds] }
      let is = vs.map(() => linear)
      let ss = vs.map((_,i) => ds[i % ds.length])
      is[is.length-1] = step // Last one is final value, not part of the event
      let totalDuration = ss.reduce((a, x) => a + x, 0)
      let p = (e,b) => {
        if (!e.countToTime) { return 0 }
        return Math.min(e.countToTime(b) - e._time, totalDuration-0.000001)
      }
      return piecewise(vs, is, ss, p)
    }
  }

  let eventIdxVar = (vs) => {
    let is = vs.map(() => step)
    let ss = vs.map(() => 1)
    return piecewise(vs, is, ss, idx)
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

    assert(1, eventIdxVar([1,2])(ev(0,1,0), 0))
    assert(2, eventIdxVar([1,2])(ev(0,1,1), 0))
    assert(1, eventIdxVar([1,2])(ev(0,1,2), 0))

    assert(1, eventTimeVar([1,2])(ev(0,1), 0))
    assert(1.5, eventTimeVar([1,2])(ev(0,1), 0.5))
    assert(2, eventTimeVar([1,2])(ev(0,1), 1))
    assert(2, eventTimeVar([1,2])(ev(0,1), 2))

    assert(1, eventTimeVar([1,2])(ev120(0,1), 0))
    assert(1.5, eventTimeVar([1,2])(ev120(0,1), 0.5))
    assert(2, eventTimeVar([1,2])(ev120(0,1), 1))
    assert(2, eventTimeVar([1,2])(ev120(0,1), 2))

    assert(1, eventTimeVar([1,2])(ev(10,2), 0))
    assert(9/8, eventTimeVar([1,2])(ev(10,2), 1/4))
    assert(1.5, eventTimeVar([1,2])(ev(10,2), 1))
    assert(1, eventTimeVar([1,2])(ev(10,2), 2))
    assert(1, eventTimeVar([1,2])(ev(10,2), 8))
    assert(1.5, eventTimeVar([1,2])(ev(10,2), 9))
    assert(1, eventTimeVar([1,2])(ev(10,2), 10))
    assert(1.5, eventTimeVar([1,2])(ev(10,2), 11))
    assert(2, eventTimeVar([1,2])(ev(10,2), 12))
    assert(2, eventTimeVar([1,2])(ev(10,2), 13))

    assert(1, eventTimeVar([1,2])(ev120(10,2), 0))
    assert(9/8, eventTimeVar([1,2])(ev120(10,2), 1/4))
    assert(1.5, eventTimeVar([1,2])(ev120(10,2), 1))
    assert(1, eventTimeVar([1,2])(ev120(10,2), 2))
    assert(1, eventTimeVar([1,2])(ev120(10,2), 8))
    assert(1.5, eventTimeVar([1,2])(ev120(10,2), 9))
    assert(1, eventTimeVar([1,2])(ev120(10,2), 10))
    assert(1.5, eventTimeVar([1,2])(ev120(10,2), 11))
    assert(2, eventTimeVar([1,2])(ev120(10,2), 12))
    assert(2, eventTimeVar([1,2])(ev120(10,2), 13))

    assert(1, eventTimeVar([1,2,3])(ev(0,1), 0))
    assert(1.5, eventTimeVar([1,2,3])(ev(0,1), 0.25))
    assert(2, eventTimeVar([1,2,3])(ev(0,1), 0.5))
    assert(2.5, eventTimeVar([1,2,3])(ev(0,1), 0.75))
    assert(3, eventTimeVar([1,2,3])(ev(0,1), 1))

    console.log('Eval timevar tests complete')
  }

  return {
    timeVar: timeVar,
    linearTimeVar: linearTimeVar,
    smoothTimeVar: smoothTimeVar,
    eventTimeVar: eventTimeVar,
    eventIdxVar: eventIdxVar,
  }
})