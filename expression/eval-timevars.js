'use strict';
define(function(require) {
  let evalOperator = require('expression/eval-operator')
  let consoleOut = require('console')

  let timeVarSteps = (vs, ds) => {
    if (!Array.isArray(ds)) { ds = [ds] }
    let steps = []
    let length = 0
    let step = 0
    vs.forEach(v => {
      let dur = ds[step % ds.length]
      steps.push({ value:v, _time:length, duration:dur })
      length += dur
      step += 1
    })
    steps.totalDuration = length
    return steps
  }

  let isInTimeVarStep  = (st, b) => {
    return (b > st._time-0.00001)&&(b < st._time+st.duration+0.00001)
  }

  let expandTimeVar = (vs, ds) => {
    let lo = vs[0] || 0
    let hi = vs[1] || lo+1
    return (e,b,evalRecurse) => {
      let elo = evalRecurse(lo, e,b)
      let ehi = evalRecurse(hi, e,b)
      if (!Number.isInteger(elo)) { consoleOut(`Warning: Time var low value ${elo} is not an integer`) }
      if (!Number.isInteger(ehi)) { consoleOut(`Warning: Time var high value ${ehi} is not an integer`) }
      let vs = Array.from({length: ehi-elo+1}, (_, i) => i + elo)
      let steps = timeVarSteps(vs, ds)
      let count = (b+0.0001) % steps.totalDuration
      let step = steps.filter(st => isInTimeVarStep(st, count) )[0]
      return (step !== undefined) && step.value
    }
  }

  let timeVar = (vs, ds) => {
    if (vs.separator == ':') {
      return expandTimeVar(vs, ds)
    }
    let steps = timeVarSteps(vs, ds)
    return (e,b) => {
      let count = (b+0.0001) % steps.totalDuration
      let step = steps.filter(st => isInTimeVarStep(st, count) )[0]
      return (step !== undefined) && step.value
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
  let calcLerp = (t, start, dur) => {
    let lerp = (t - start) / Math.max(dur, 0.0001)
    lerp = Math.min(Math.max(lerp, 0), 1)
    return lerp
  }

  let linearTimeVar = (vs, ds) => {
    let steps = timeVarSteps(vs, ds)
    return (e,b) => {
      let count = b % steps.totalDuration
      for (let idx = 0; idx < steps.length; idx++) {
        let pre = steps[idx]
        if (isInTimeVarStep(pre, count)) {
          let post = steps[(idx+1) % steps.length]
          let lerp = calcLerp(count, pre._time, pre.duration)
          return lerpValue(lerp, pre.value, post.value)
        }
      }
    }
  }

  let smoothTimeVar = (vs, ds) => {
    let steps = timeVarSteps(vs, ds)
    return (e,b) => {
      let count = b % steps.totalDuration
      for (let idx = 0; idx < steps.length; idx++) {
        let pre = steps[idx]
        if (isInTimeVarStep(pre, count)) {
          let post = steps[(idx+1) % steps.length]
          let lerp = calcLerp(count, pre._time, pre.duration)
          lerp = lerp*lerp*(3 - 2*lerp) // bezier ease in/out
          return lerpValue(lerp, pre.value, post.value)
        }
      }
    }
  }

  let eventTimeVar = (vs, ds_parsed) => {
    return (e,b) => {
      if (vs.length === 0) { return 0 }
      if (vs.length === 1) { return vs[0] }
      if (!e.countToTime) { return vs[0] || 0 }
      let ds = ds_parsed
      let eDur = e.endTime - e._time
      if (ds === undefined) { // If no durations set, then create durations to space the values out evenly through the event duration
        let d = eDur / (vs.length-1)
        ds = new Array(vs.length-1).fill(d)
        ds.push(0)
      }
      let steps = timeVarSteps(vs, ds)
      let time = e.countToTime(b) - e._time
      if (time >= steps.totalDuration) {
        time = steps.totalDuration
      } else {
        time = (time % steps.totalDuration + steps.totalDuration) % steps.totalDuration
      }
      for (let idx = 0; idx < steps.length; idx++) {
        let pre = steps[idx]
        if (isInTimeVarStep(pre, time)) {
          let post = steps[idx+1]
          if (post === undefined) { post = pre }
          let lerp = calcLerp(time, pre._time, pre.duration)
          return lerpValue(lerp, pre.value, post.value)
        }
      }
    }
  }

  let eventIdxVar = (vs) => {
    return (e,b) => {
      let v = vs[Math.floor(e.idx || 0) % vs.length]
      return (v !== undefined) && v
    }
  }

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  
    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
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