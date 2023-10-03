'use strict';
define(function(require) {
  let eatWhitespace = require('expression/eat-whitespace')
  let literal = require('pattern/literal/literal.js')
  let loop = require('pattern/operator/loop.js')
  let concat = require('pattern/operator/concat.js')

  let isWhitespace = (char) => char === '' || char === ' ' || char === '\t'
  let keyword = (state, kw) => {
    if (state.str.slice(state.idx, state.idx + kw.length) !== kw) { return false} // Keyword doesn't match
    let char = state.str[state.idx + kw.length]
    if (!!char && !isWhitespace(char)) { return false } // Keyword not followed by whitespace or eof
    state.idx += kw.length+1
    return true
  }

  let parsePattern = (state) => {
    let playFromStart = keyword(state, 'now')
    let result = literal(state)
    eatWhitespace(state)
    if (keyword(state, 'loop')) {
      result = loop(state, result)
    }
    else if (keyword(state, '+')) {
      eatWhitespace(state)
      let r = literal(state)
      result = concat(result, r)
    }
    eatWhitespace(state)
    if (state.str[state.idx] !== undefined) { throw `Invalid pattern: extra pattern data ${state.str.slice(state.idx)}` }
    result.playFromStart = playFromStart
    return result
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual, msg) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}\n${msg}`) }
    }
    let assertThrows = (expected, code) => {
      let got
      try {code()}
      catch (e) { if (e.includes(expected)) {got=true} else {console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: ${e}`)} }
      finally { if (!got) console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: none` ) }
    }
    let st = (str) => { return { str:str, idx:0 } }

    assert(true, keyword(st('loop 1'), 'loop'))
    assert(true, keyword(st('loop\t1'), 'loop'))
    assert(true, keyword(st('loop'), 'loop'))
    assert(false, keyword(st('loop 1'), 'loo'))
    assert(false, keyword(st('loop 1'), 'loopy'))
    assert(false, keyword(st('loop1'), 'loop'))

    assertThrows('Invalid argument to pattern loop operator', () => parsePattern(st('01 loop')))
    assertThrows('Invalid argument to pattern loop operator', () => parsePattern(st('01 loop foo')))
    assertThrows('Invalid pattern: extra pattern data foo', () => parsePattern(st('01 loop 1foo')))
    assertThrows('Invalid pattern: extra pattern data foo', () => parsePattern(st('01 foo')))
    assertThrows('Invalid pattern: extra pattern data foo', () => parsePattern(st('01 loop 1 foo')))

    console.log("Pattern parse tests complete")
  }
  
  return parsePattern
});
