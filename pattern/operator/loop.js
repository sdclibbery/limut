'use strict';
define(function(require) {
  let eatWhitespace = require('expression/eat-whitespace')

  let digitChar = (char) => char >= '0' && char <= '9'
  let parseCount = (state) => {
    let value = ''
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char == '') { break }
      if (!digitChar(char)) { break }
      value += char
      state.idx++
    }
    if (value == '') { throw `Invalid argument to pattern loop operator` }
    let result = parseInt(value)
    if (Number.isNaN(result)) { throw `Invalid argument ${value} to pattern loop operator` }
    return result
  }

  let loop = (state, target) => {
    eatWhitespace(state)
    let loopCount = parseCount(state)
    let loops = 0
    let pattern = {
      next: () => {
        if (loops >= loopCount) { return undefined } // return a rest if loops have finished
        return target.next()
      },
      loop: () => {
        loops++
        target.loop()
      },
      reset: () => { // Ignore reset repeat count
        loops = 0
        target.reset(0)
      },
      start: () => { // TC init is complete
        pattern.reset()
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

    p = loop(st(' 2'), testPattern())
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
