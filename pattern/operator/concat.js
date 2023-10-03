'use strict';
define(function(require) {

  let concat = (l, r) => {
    let current = l
    let pattern = {
      next: () => {
        let result = current.next()
        if (result === undefined) {
          current = r
          result = current.next()
        }
        return result
      },
      loop: () => {
        l.loop()
        r.loop()
        current = l
      },
      reset: (numTimesLooped) => {
        l.reset(numTimesLooped)
        r.reset(numTimesLooped)
        current = l
      },
      start: () => { // TC init is complete
        if (l.start) { l.start() }
        if (r.start) { r.start() }
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

    p = concat(testPattern('x'), testPattern('y'))
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'y',dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:'x',dur:1}], p.next())

    console.log("Pattern concat tests complete")
  }
  
  return concat
});
