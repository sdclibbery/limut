'use strict';
define(function(require) {
  let consoleOut = require('console')
  let {piecewise} = require('expression/eval-piecewise')

  let step = () => 0
  step.segmentPower = 0
  let linear = (i) => i
  linear.segmentPower = 1

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

  let eventTimeVar = (vs, is, ss, ds, addSegmentData) => {
    if (vs.length === 0) { return piecewise([], [], [], 0, {}) }
    if (vs.length === 1) { return piecewise(vs, [step], [1], ()=>0, {}) }
    let haveAnySs = ss.reduce((a, s) => a||(s!==undefined), false)
    if (ds === undefined && !haveAnySs) { // If no durations set, space out evenly through the event
      is = is.map(i => i || linear)
      ss = ss.map(s => s!==undefined ? s : 1)
      is[is.length-1] = step // Last one is final value, not part of the event
      ss[ss.length-1] = 0
      let p = (e,b) => (b - e.count) / (e.dur) // Normalise param
      let m = (v,e,b) => v + e.count // Map back to absolute count
      return piecewise(vs, is, ss, p, {clamp:true,normalise:true,addSegmentData:addSegmentData,nextSegmentMapper:m})
    } else { // Use durations provided
      if (!Array.isArray(ds)) { ds = [ds || 1] }
      is = is.map(i => i || linear)
      ss = ss.map((s,idx) => s!==undefined ? s : ds[idx % ds.length])
      is[is.length-1] = step // Last one is final value, not part of the event
      let p = (e,b) => b - e.count // Param is event count
      let m = (v,e,b) => v + e.count // Map back to absolute count
      return piecewise(vs, is, ss, p, {clamp:true,addSegmentData:addSegmentData,nextSegmentMapper:m})
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
    let {evalParamFrame} = require('player/eval-param')
    let u2=[undefined,undefined]
    let u3=[undefined,undefined,undefined]
    let val = v => v.value

    assert(1, evalParamFrame(eventTimeVar([1,2],u2,u2,undefined,false),ev(0,1), 0))

    assert(1, val(evalParamFrame(eventTimeVar([1,2],u2,u2,undefined,true),ev(0,1), 0)))
    assert(1.5, val(evalParamFrame(eventTimeVar([1,2],u2,u2,undefined,true),ev(0,1), 0.5)))
    assert(2, evalParamFrame(eventTimeVar([1,2],u2,u2,undefined,true),ev(0,1), 1))
    assert(2, evalParamFrame(eventTimeVar([1,2],u2,u2,undefined,true),ev(0,1), 2))

    assert(1, val(evalParamFrame(eventTimeVar([1,2],u2,u2,undefined,true),ev(10,2), 9)))
    assert(1, val(evalParamFrame(eventTimeVar([1,2],u2,u2,undefined,true),ev(10,2), 10)))
    assert(1.5, val(evalParamFrame(eventTimeVar([1,2],u2,u2,undefined,true),ev(10,2), 11)))
    assert(2, evalParamFrame(eventTimeVar([1,2],u2,u2,undefined,true),ev(10,2), 12))
    assert(2, evalParamFrame(eventTimeVar([1,2],u2,u2,undefined,true),ev(10,2), 13))

    assert(1, val(evalParamFrame(eventTimeVar([1,2,3],u3,u3,undefined,true),ev(0,1), 0)))
    assert(1.5, val(evalParamFrame(eventTimeVar([1,2,3],u3,u3,undefined,true),ev(0,1), 0.25)))
    assert(2, val(evalParamFrame(eventTimeVar([1,2,3],u3,u3,undefined,true),ev(0,1), 0.5)))
    assert(2.5, val(evalParamFrame(eventTimeVar([1,2,3],u3,u3,undefined,true),ev(0,1), 0.75)))
    assert(3, evalParamFrame(eventTimeVar([1,2,3],u3,u3,undefined,true),ev(0,1), 1))

    console.log('Eval timevar tests complete')
  }

  return {
    timeVar: timeVar,
    rangeTimeVar: rangeTimeVar,
    eventTimeVar: eventTimeVar,
  }
})