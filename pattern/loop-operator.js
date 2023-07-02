'use strict';
define(function(require) {
  let eatWhitespace = require('expression/eat-whitespace.js')

  let tryParseKeyword = (state, keyword) => {
    let tryIdx = state.idx
    let keywordIdx = 0
    let char
    while (char = state.str.charAt(tryIdx)) {
      let keywordChar = keyword.charAt(keywordIdx)
      if (!keywordChar) {
        state.idx = tryIdx
        return true // Matched entire keyword
      }
      if (char !== keywordChar) { return false } // Didn't match
      tryIdx++
      keywordIdx++
    }
    return false // Ran out of input
  }

  let tryParseInteger = (state) => {
    if (Number.isNaN(parseInt(state.str.slice(state.idx)))) { return } // Not an integer
    let value = ''
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char < '0' || char > '9') { break }
      value += char
      state.idx++
    }
    return parseInt(value)
  }

  let loopOperator = (state, literal) => {
    eatWhitespace(state)
    if (!tryParseKeyword(state, 'loop')) { return }
    eatWhitespace(state)
    let loopCount = tryParseInteger(state) // IMPLEMENT ME
    if (loopCount === undefined) { return }
    // Now do the actual loop thingy...
    return literal // TEMP
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual, msg) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`+(!!msg?'\n'+msg:'')) }
    }

    let lit = (count, timingContext) => [{ value:'x', _time:count, dur:1 }]
    let pattern, tc
    let st = (str) => { return { str:str, idx:0 } }

    assert(undefined, loopOperator(st('foo'), lit))
    assert(undefined, loopOperator(st(' foo 2'), lit))
    assert(undefined, loopOperator(st('loop'), lit))
    assert(undefined, loopOperator(st('loop foo'), lit))

    tc = {}
    pattern = loopOperator(st(' loop 1'), lit)
    assert([{ value:'x', _time:0, dur:1 }], pattern(0, tc))
    assert([], pattern(1, tc))

    tc = {}
    pattern = loopOperator(st(' loop 2'), lit)
    assert([{ value:'x', _time:0, dur:1 }], pattern(0, tc))
    assert([{ value:'x', _time:0, dur:1 }], pattern(1, tc))
    assert([], pattern(2, tc))

    console.log("Pattern Loop Operator tests complete")
  }
  
  return loopOperator
});
