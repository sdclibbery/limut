'use strict';
define(function(require) {
  let loop = (target, loopCount) => {
    let loops = 0
    let justStarted = true
    let pattern = {
      next: () => {
        if (loops >= loopCount) { return undefined } // return a rest if loops have all finished
        let result = target.next()
        if (!!result) { justStarted = false }
        return result
      },
      loop: () => {
        if (!justStarted) { loops++ } // Do not count the loop if we've just started playing, otherwise a single step loop can end before playing any event
        target.loop()
      },
      reset: (numTimesLooped) => {
        loops = 0
        justStarted = true
        target.reset(numTimesLooped)
      },
      start: () => { // TC init is complete
        loops = 0
        justStarted = true
        if (target.start) { target.start() }
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
    let testPattern = () => {
      let i = 0
      return {
        next: () => i++ %2 ? undefined :  [{value:'x',dur:1}],
        loop: () => {},
        reset: () => {},
      }
    }
    let p

    p = loop(testPattern(), 2)
    assert([{value:'x',dur:1}], p.next()) // First loop
    assert(undefined, p.next())
    p.loop()
    assert([{value:'x',dur:1}], p.next()) // Second loop
    assert(undefined, p.next())
    p.loop()
    assert(undefined, p.next()) // Get more undefined after loops are expired
    assert(undefined, p.next())
    p.reset()
    assert([{value:'x',dur:1}], p.next()) // Start again after reset
    assert(undefined, p.next())
    p.loop()
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert(undefined, p.next())

    console.log("Pattern loop tests complete")
  }
  
  return loop
});
