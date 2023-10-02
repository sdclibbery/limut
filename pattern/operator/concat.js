'use strict';
define(function(require) {
  let eatWhitespace = require('expression/eat-whitespace')
  let literal = require('pattern/literal/literal.js')

  let concat = (state, l) => {
    eatWhitespace(state)
    let r = literal(state)
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
    let st = (str) => { return { str:str, idx:0 } }
    let testPattern = () => {
      let i = 0
      return {
        next: () => i++ %2 ? undefined :  [{value:'x',dur:1}],
        loop: () => {},
        reset: () => {},
      }
    }
    let p

    p = concat(st(' y'), testPattern())
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'y',dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:'x',dur:1}], p.next())

    console.log("Pattern concat tests complete")
  }
  
  return concat
});
