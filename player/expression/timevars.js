'use strict';
define(function(require) {
  let {intervalLte} = require('player/expression/eval-intervals')

  let timeVarSteps = (vs, ds) => {
    if (!Array.isArray(ds)) { ds = [ds] }
    ds = ds.map(d => (typeof d =='number') ? d : d.value || 4)
    let steps = []
    let length = 0
    let step = 0
    vs.forEach(v => {
      let dur = ds[step % ds.length]
      steps.push({ value:v, time:length, duration:dur })
      length += dur
      step += 1
    })
    steps.totalDuration = length
    return steps
  }

  let isInTimeVarStep  = (st, b) => {
    return (b > st.time-0.0001)&&(b < st.time+st.duration+0.0001)
  }

  let timeVar = (steps, s,b) => {
    b = (b+0.0001) % steps.totalDuration
    let step = steps.filter(st => isInTimeVarStep(st, b) )[0]
    return (step == undefined) ? steps[0].value : step.value
  }

  let evaluate = (e, evalExpression, maxInterval, s,b) => {
    if (e.type !== 'timevar') { return }
    if (intervalLte(e.eval, maxInterval)) {
      return evalExpression(timeVar(e.steps, s,b))
    }
  }

  return {
    timeVarSteps: timeVarSteps,
    eval: evaluate,
  }
})