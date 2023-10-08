'use strict';
define(function(require) {

  let repeat = (l, repeatCount) => {
    let repeats = 0
    let pattern = {
      next: () => {
        let result = l.next()
        if (result === undefined) {
          repeats++
          if (repeats < repeatCount) {
            l.loop()
            result = l.next()
          }
        }
        return result
      },
      loop: () => {
        l.loop()
        repeats = 0
      },
      reset: (numTimesLooped) => {
        l.reset(numTimesLooped)
        repeats = 0
      },
      start: () => { // TC init is complete
        if (l.start) { l.start() }
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
    let testPattern = (v) => {
      let i = 0
      return {
        next: () => i++ == 0 ? [{value:v,dur:1}] : undefined,
        loop: () => { i=0 },
        reset: () => { i=0 },
      }
    }
    let p

    p = repeat(testPattern('x'), 2)
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())

    console.log("Pattern repeat tests complete")
  }
  
  return repeat
});
