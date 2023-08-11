'use strict';
define(function(require) {

  let supersequence = (steps) => { // SuperSequence <> works differently; gives one step only on each loop
    let stepIdx = 0
    let active = true
    let pattern = {
      //---
      // Pattern Interface
      //---
      next: () => { // Get the next step of event(s)
        if (steps.length === 0) { return undefined }
        if (!active) {
          active = true // Next time, return step
          stepIdx++
          return undefined
        }
        let step = steps[stepIdx]
        if (step && step.next) { // Sub pattern
          let subStep = step.next()
          if (subStep !== undefined) {
            return subStep
          }
          active = false // Next time, move on in parent pattern
          return pattern.next()
        }
        active = false // Next time, move on in parent pattern
        if (step === undefined) { // Loop this supersequence only
          stepIdx = 0
          active = true
          return pattern.next()
        }
        return step
      },

      loop: () => { // Loop this pattern back to its beginning
        active = true
        // Don't reset stepIdx, the whole point of a supersequence is it changes from loop to loop
        steps.forEach(s => { if (s.loop) s.loop() }) // loop sub patterns
      },

      reset: (numTimesLooped) => { // Reset this pattern back to its beginning
        active = true
        stepIdx = numTimesLooped % steps.length // Do fully reset step on reset, taking loop count into account for tc init
        steps.forEach(s => {
          if (s.reset) { s.reset(Math.floor(numTimesLooped / steps.length)) } // sub pattern loop count is based on how many times this supersequence would have looped
        }) // Reset sub patterns
      },

      //---
      // Literal Interface
      //---
      scaleToFit: (scale) => { // Scale the durations within this pattern based on its length
                               // Used to scale subpatterns to fit in one step duration of the parent pattern
        if (scale === undefined) {
          scale = 1
        }
        steps.forEach(s => {
          if (s.scaleToFit) {
            s.scaleToFit(scale) // Recurse to sub pattern
          } else {
            s.forEach(e => e.dur *= scale) // Apply duration scale to the events in this step
          }
        })
      },

      extendDur: (dur) => { // Extend the duration of all steps
        steps.forEach(step => { // Unlike supersequence pattern, extend dur for every step in a supersequence
          if (step.extendDur) {
            step.extendDur(dur)
          } else {
            step.forEach(e => e.dur += dur)
          }
        })
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
    let p

    p = supersequence([]) // No steps
    p.scaleToFit()
    assert(undefined, p.next())
    assert(undefined, p.next())

    p = supersequence([
      [{value:0,dur:1}],
      [{value:1,dur:1}],
      [{value:2,dur:1}],
    ])
    assert([{value:0,dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:1,dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:2,dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:0,dur:1}], p.next())
    assert(undefined, p.next())

    p = supersequence([[{value:0,dur:1}],[{value:1,dur:1}]])
    p.scaleToFit()
    assert([{value:0,dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:1,dur:1}], p.next())
    assert(undefined, p.next())

    p = supersequence([[{value:0,dur:1}],[{value:1,dur:1}]])
    p.extendDur(1)
    assert([{value:0,dur:2}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:1,dur:2}], p.next())
    assert(undefined, p.next())

    console.log("Pattern supersequence tests complete")
  }
  
  return supersequence
});
