'use strict';
define(function(require) {
  let evalOperator = require('player/eval-operator')

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
      if (!e.countToTime) { return vs[0] || 0 }
      let ds = ds_parsed
      if (ds === undefined) { ds = e.endTime - e._time }
      let steps = timeVarSteps(vs, ds)
      let count = e.countToTime(b) - e._time
      if (count < 0) { count = 0 }
      if (count > steps.totalDuration) { count = steps.totalDuration }
      for (let idx = 0; idx < steps.length; idx++) {
        let pre = steps[idx]
        if (isInTimeVarStep(pre, count)) {
          let post = steps[idx+1]
          if (post === undefined) { post = pre }
          let lerp = calcLerp(count, pre._time, pre.duration)
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

  return {
    timeVar: timeVar,
    linearTimeVar: linearTimeVar,
    smoothTimeVar: smoothTimeVar,
    eventTimeVar: eventTimeVar,
    eventIdxVar: eventIdxVar,
  }
})