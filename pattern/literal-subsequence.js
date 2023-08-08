'use strict';
define(function(require) {

  let subsequence = (steps) => { // Sub Sequence pattern; series of steps in order
    let stepIdx = 0
    let pattern = {
      //---
      // Pattern Interface
      //---
      next: () => { // Get the next step of event(s)
        let step = steps[stepIdx]
        if (step && step.next) { // Sub pattern
          let subStep = step.next()
          if (subStep !== undefined) { return subStep}
          stepIdx++ // Sub pattern has finished
          return pattern.next()
        }
        stepIdx++
        return step
      },

      loop: () => { // Loop this pattern back to its beginning
        stepIdx = 0
        steps.forEach(s => { if (s.loop) s.loop() }) // Reset sub patterns
      },

      reset: (numTimesLooped) => { // Reset this pattern back to its beginning
        stepIdx = 0
        steps.forEach(s => { if (s.reset) s.reset(numTimesLooped) }) // Reset sub patterns
      },

      //---
      // Literal Interface
      //---
      scaleToFit: (scale) => { // Scale the durations within this pattern based on its length
                               // Used to scale subpatterns to fit in one step duration of the parent pattern
        if (scale === undefined) {
          let length = steps.length + steps.numContinuations
          scale = 1 / length
        }
        steps.forEach(s => {
          if (s.scaleToFit) {
            s.scaleToFit(scale) // Recurse to sub pattern
          } else {
            s.forEach(e => e.dur *= scale) // Apply duration scale to the events in this step
          }
        })
      },

      extendDur: (dur, addRest) => { // Extend the duration of the last step
        let step = steps[steps.length-1]
        if (step.extendDur) {
          step.extendDur(dur, addRest)
        } else {
          step.forEach(e => e.dur += dur)
          if (addRest) { step.push({dur:1}) }
        }
      },
    }
    return pattern
  }


  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual, msg) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}\n${msg}`) }
    }
    let p, steps

    p = subsequence([
      [{value:0,dur:1}],
      [{value:-1,dur:1}],
      [{value:2,dur:2}],
      [{value:undefined,dur:1}],
      [{value:'x',dur:1}],
      [{value:'-',dur:1}],
    ])
    assert([{value:0,dur:1}], p.next())
    assert([{value:-1,dur:1}], p.next())
    assert([{value:2,dur:2}], p.next())
    assert([{value:undefined,dur:1}], p.next())
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'-',dur:1}], p.next())
    assert(undefined, p.next())

    p = subsequence([[{value:'x',dur:1}]])
    p.reset(0)
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())
    p.reset(0)
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())

    steps = [
      [{value:0,dur:1}],
      [{value:1,dur:1}],
      [{value:2,dur:1}],
    ]
    steps.numContinuations = 0
    steps.initialContinuations = 0
    p = subsequence(steps)
    p.scaleToFit()
    assert([{value:0,dur:1/3}], p.next())
    assert([{value:1,dur:1/3}], p.next())
    assert([{value:2,dur:1/3}], p.next())
    assert(undefined, p.next())

    p = subsequence([[{value:0,dur:1}],[{value:1,dur:1}]])
    p.extendDur(1)
    assert([{value:0,dur:1}], p.next())
    assert([{value:1,dur:2}], p.next())
    assert(undefined, p.next())

    console.log("Pattern subsequence tests complete")
  }
  
  return subsequence
});
