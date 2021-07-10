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

  let timeVar = (vs, ds, interval) => {
    let steps = timeVarSteps(vs, ds)
    return (e,b, evalRecurse) => {
      let count = b
      if (interval !== 'frame') { count = e.count }
      count = (count+0.0001) % steps.totalDuration
      let step = steps.filter(st => isInTimeVarStep(st, count) )[0]
      return (step !== undefined) && evalRecurse(step.value, e,b)
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

  let linearTimeVar = (vs, ds, interval) => {
    let steps = timeVarSteps(vs, ds)
    return (e,b, evalRecurse) => {
      let count = b
      if (interval !== 'frame') { count = e.count }
      count = count % steps.totalDuration
      for (let idx = 0; idx < steps.length; idx++) {
        let pre = evalRecurse(steps[idx], e,b)
        if (isInTimeVarStep(pre, count)) {
          let post = evalRecurse(steps[(idx+1) % steps.length], e,b)
          let lerp = (count - pre._time) / pre.duration
          return lerpValue(lerp, pre.value, post.value)
        }
      }
    }
  }

  let smoothTimeVar = (vs, ds, interval) => {
    let steps = timeVarSteps(vs, ds)
    return (e,b, evalRecurse) => {
      let count = b
      if (interval !== 'frame') { count = e.count }
      count = count % steps.totalDuration
      for (let idx = 0; idx < steps.length; idx++) {
        let pre = evalRecurse(steps[idx], e,b)
        if (isInTimeVarStep(pre, count)) {
          let post = evalRecurse(steps[(idx+1) % steps.length], e,b)
          let lerp = (count - pre._time) / pre.duration
          lerp = lerp*lerp*(3 - 2*lerp) // bezier ease in/out
          return lerpValue(lerp, pre.value, post.value)
        }
      }
    }
  }

  let eventTimeVar = (vs) => {
    return (e,b, evalRecurse) => {
      if (!e.countToTime) { return evalRecurse(vs[0] || 0, e,b, evalRecurse) }
      let eventFraction = (e.countToTime(b) - e._time) / (e.endTime - e._time)
      eventFraction = eventFraction || 0
      let numSteps = vs.length-1
      let preIdx = Math.min(Math.max(Math.floor(eventFraction * numSteps), 0), numSteps)
      let postIdx = Math.min(preIdx + 1, numSteps)
      let pre = evalRecurse(vs[preIdx], e,b, evalRecurse)
      let post = evalRecurse(vs[postIdx], e,b, evalRecurse)
      let lerp = Math.min(Math.max((eventFraction - preIdx/numSteps)*numSteps, 0), 1)
      return lerpValue(lerp, pre, post)
    }
  }

  return {
    timeVar: timeVar,
    linearTimeVar: linearTimeVar,
    smoothTimeVar: smoothTimeVar,
    eventTimeVar: eventTimeVar,
  }
})