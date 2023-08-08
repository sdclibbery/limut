'use strict';
define(function(require) {

  let minDur = (es) => Math.min(...es.map(e => e.dur))

  let chord = (steps) => { // Chord () play each step as its own pattern in parallel
    let stepTime = steps.map(() => 0)
    let chordTime = 0
    let pattern = {
      //---
      // Pattern Interface
      //---
      next: () => { // Get the next step of event(s)
        let result = steps
          .flatMap((s,i) => {
            let es
            if (s.next && stepTime[i] <= chordTime+0.0001) { // Evaluate subpatterns when its time
              es = s.next()
            }
            if (!s.next && chordTime === 0) { // Play an immediate literal event only on the first step in the chord
              es = s
            }
            if (Array.isArray(es)) {
              stepTime[i] += minDur(es)
            } else if (!!es) {
              stepTime[i] += es.dur
            }
            return es
          })
          .filter(e => e !== undefined)
        if (result.length === 0) { return undefined } // All finished in this chord
        let nextChordTimeFromThisStep = chordTime + minDur(result)
        let nextRequiredStepTime = Math.min(...stepTime)
        if (nextRequiredStepTime < nextChordTimeFromThisStep) { // If the min dur from these events would go past the next time we need to send events...
          result.push({dur: nextRequiredStepTime-chordTime}) // ...then add a short rest to bring up only to the next required time
        }
        chordTime += minDur(result)
        return result
      },

      loop: () => { // Loop this pattern back to its beginning
        stepTime = steps.map(() => 0)
        chordTime = 0
        steps.forEach(s => { if (s.loop) s.loop() }) // loop sub patterns
      },

      reset: (numTimesLooped) => { // Reset this pattern back to its beginning
        stepTime = steps.map(() => 0)
        chordTime = 0
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

      extendDur: (dur, addRest) => { // Extend the duration of the last step
        steps.forEach(step => { // Unlike subsequence pattern, extend dur for every step in a chord
          if (step.extendDur) {
            step.extendDur(dur, addRest)
          } else {
            step.forEach(e => e.dur += dur)
            if (addRest) { step.push({dur:1}) }
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
    let subTest = (...steps) => {
      let i = 0
      return {
        next: () => steps[i++],
        reset: () => {},
      }
    }

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
    p.extendDur(1)
    assert([{value:0,dur:2},{value:1,dur:2}], p.next())
    assert(undefined, p.next())

    p = chord([
      {value:0,dur:1},
      subTest({value:1,dur:1/2}, {value:2,dur:1/2}),
    ])
    assert([{value:0,dur:1},{value:1,dur:1/2}], p.next())
    assert([{value:2,dur:1/2}], p.next())
    assert(undefined, p.next())

    p = chord([
      subTest({value:0,dur:1/2}, {value:1,dur:1/2}),
      subTest({value:2,dur:1/3}, {value:3,dur:1/3}, {value:4,dur:1/3}),
    ])
    assert([{value:0,dur:1/2},{value:2,dur:1/3}], p.next())
    assert([{value:3,dur:1/3},{dur:1/6}], p.next()) // Including a short rest to line up the next step correctly
    assert([{value:1,dur:1/2},{dur:1/6}], p.next()) // Including a short rest to line up the next step correctly
    assert([{value:4,dur:1/3}], p.next())
    assert(undefined, p.next())

    console.log("Pattern chord tests complete")
  }
  
  return chord
});
