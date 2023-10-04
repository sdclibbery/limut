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

  let parseElement = (state) => {
    let result
    eatWhitespace(state)
    if (state.str[state.idx] === undefined) { return undefined }
    let startIdx = state.idx
    if (keyword(state, 'loop')) {
      result = {keyword:'loop'}
    }
    else if (keyword(state, '+')) {
      result = {keyword:'+'}
    }
    else {
      result = literal(state)
    }
    result.src = state.str.slice(startIdx, state.idx)
    return result
  }

  let parsePattern = (state) => {
    let playFromStart = keyword(state, 'now')

    // Parse elements
    let elements = []
    let element = parseElement(state)
    while (!!element) {
      elements.push(element)
      element = parseElement(state)
    }

    // Apply operator precedence

    // Build result pattern expression
    let idx = 0
    let result = elements[idx++]
    if (!elements[idx]) { // Nothing more
    } else if (elements[idx].keyword === 'loop') {
      idx++
      let loopCountElement = elements[idx++]
      if (!loopCountElement) { throw `Invalid pattern: missing loop count` }
      let loopCount = parseInt(loopCountElement.src)
      if (!loopCount) { throw `Invalid pattern: invalid loop count ${loopCountElement.src}` }
      result = loop(result, loopCount)
    }
    else if (elements[idx].keyword === '+') {
      idx++
      let r = elements[idx++]
      if (r.keyword !== undefined) { throw `Invalid pattern: invalid r argument to + : ${r.src}` }
      result = concat(result, r)
    }

    // Finish up
    if (result.keyword) { throw `Invalid pattern: missing literal` }
    if (elements[idx] !== undefined) { throw `Invalid pattern: extra pattern data ${elements[idx].src}` }
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
      catch (e) { if ((''+e).includes(expected)) {got=true} else {console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: ${e}`)} }
      finally { if (!got) console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: none` ) }
    }
    let st = (str) => { return { str:str, idx:0 } }

    assert(true, keyword(st('loop 1'), 'loop'))
    assert(true, keyword(st('loop\t1'), 'loop'))
    assert(true, keyword(st('loop'), 'loop'))
    assert(false, keyword(st('loop 1'), 'loo'))
    assert(false, keyword(st('loop 1'), 'loopy'))
    assert(false, keyword(st('loop1'), 'loop'))

    assertThrows('Invalid pattern: missing loop count', () => parsePattern(st('01 loop')))
    assertThrows('Invalid pattern: invalid loop count foo', () => parsePattern(st('01 loop foo')))
    assertThrows('Invalid pattern: extra pattern data foo', () => parsePattern(st('01 foo')))
    assertThrows('Invalid pattern: extra pattern data foo', () => parsePattern(st('01 loop 1 foo')))
    assertThrows('Invalid pattern: missing literal', () => parsePattern(st(' loop 1')))

    console.log("Pattern parse tests complete")
  }
  
  return parsePattern
});
