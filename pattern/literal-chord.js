'use strict';
define(function(require) {

  let chord = (steps) => { // Chord () play each step as iots own pattern in parallel
    let stepIdx = 0
    let pattern = {
      //---
      // Pattern Interface
      //---
      next: () => { // Get the next step of event(s)
        let result = steps
          .flatMap(s => {
            if (s.next) { return s.next() } // Evaluate subpatterns every time
            if (stepIdx === 0) { return s } // Use an immediate literal event on the first step in the chord
          })
          .filter(e => e !== undefined)
        stepIdx++
        if (result.length === 0) { return undefined } // All finished in this chord
        return result
      },

      loop: () => { // Loop this pattern back to its beginning
        stepIdx = 0
        steps.forEach(s => { if (s.loop) s.loop() }) // loop sub patterns
      },

      reset: (numTimesLooped) => { // Reset this pattern back to its beginning
        stepIdx = 0
        steps.forEach(s => { if (s.reset) { s.reset(Math.floor(numTimesLooped)) } }) // Reset sub patterns
      },

      //---
      // Literal Interface
      //---
      scaleToFit: (scale) => { // Scale the durations within this pattern based on its length
                               // Used to scale subpatterns to fit in one step duration of the parent pattern
        if (scale === undefined) {
          scale = 1 // Entire chord fits in one step by default
        }
        steps.forEach(s => {
          if (s.scaleToFit) {
            s.scaleToFit(scale) // Recurse to sub pattern
          } else {
            s.forEach(e => e.dur *= scale) // Apply duration scale to the events in this step
          }
        })
      },

      extendDur: () => { // Extend the duration of the last step
        steps.forEach(step => { // Unlike subsequence pattern, extend dur for every step in a chord
          if (step.extendDur) {
            step.extendDur()
          } else {
            step.forEach(e => e.dur++)
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

    p = chord([
      [{value:0,dur:1}],
      [{value:1,dur:1}],
      [{value:2,dur:1}],
    ])
    assert([{value:0,dur:1},{value:1,dur:1},{value:2,dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:0,dur:1},{value:1,dur:1},{value:2,dur:1}], p.next())
    assert(undefined, p.next())

    p = chord([[{value:0,dur:1}],[{value:1,dur:1}]])
    p.scaleToFit()
    assert([{value:0,dur:1},{value:1,dur:1}], p.next())
    assert(undefined, p.next())

    p = chord([[{value:0,dur:1}],[{value:1,dur:1}]])
    p.scaleToFit(1/2)
    assert([{value:0,dur:1/2},{value:1,dur:1/2}], p.next())
    assert(undefined, p.next())

    p = chord([[{value:0,dur:1}],[{value:1,dur:1}]])
    p.extendDur()
    assert([{value:0,dur:2},{value:1,dur:2}], p.next())
    assert(undefined, p.next())

    console.log("Pattern chord tests complete")
  }
  
  return chord
});
