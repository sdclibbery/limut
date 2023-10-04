'use strict';
define(function(require) {
  let eatWhitespace = require('expression/eat-whitespace')
  let literal = require('pattern/literal/literal.js')

  let keywords = [
    {keyword:'loop', r:parseInt, action:require('pattern/operator/loop.js')},
    {keyword:'+', action:require('pattern/operator/concat.js')},
  ]

  let isWhitespace = (char) => char === '' || char === ' ' || char === '\t'
  let keyword = (state, kw) => {
    if (state.str.slice(state.idx, state.idx + kw.length).toLowerCase() !== kw) { return false} // Keyword doesn't match
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
    for (let idx in keywords) {
      let k = keywords[idx]
      if (keyword(state, k.keyword)) {
        result = Object.assign({}, k)
        break
      }
    }
    if (!result) {
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
    while (!!elements[idx]) {
      let element = elements[idx++]
      if (element.keyword) {
        let r = elements[idx++]
        if (r === undefined) { throw `Invalid pattern: missing argument to operator ${element.keyword}` }
        if (r.keyword !== undefined) { throw `Invalid pattern: invalid argument ${r.src} to operator ${element.keyword}` }
        if (element.r) {
          let src = r.src
          r = element.r(src)
          if (!r) { throw `Invalid pattern: invalid argument ${src} to operator ${element.keyword}` }
        }
        result = element.action(result, r)
      }
    }

    // Finish up
    if (result.keyword) { throw `Invalid pattern: missing literal` }
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
      catch (e) { if ((''+e).includes(expected)) {got=true} else {console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: ${e}`);} }
      finally { if (!got) console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: none` ) }
    }
    let st = (str) => { return { str:str, idx:0 } }

    assert(true, keyword(st('loop 1'), 'loop'))
    assert(true, keyword(st('loop\t1'), 'loop'))
    assert(true, keyword(st('loop'), 'loop'))
    assert(true, keyword(st('LOOP'), 'loop'))
    assert(true, keyword(st('looP'), 'loop'))
    assert(false, keyword(st('loop 1'), 'loo'))
    assert(false, keyword(st('loop 1'), 'loopy'))
    assert(false, keyword(st('loop1'), 'loop'))

    assertThrows('Invalid pattern: missing argument to operator loop', () => parsePattern(st('01 loop')))
    assertThrows('Invalid pattern: invalid argument foo to operator loop', () => parsePattern(st('01 loop foo')))
    assertThrows('Invalid pattern: missing argument to operator +', () => parsePattern(st(' loop +')))
    assertThrows('Invalid pattern: invalid argument loop to operator +', () => parsePattern(st('0 + loop')))

    console.log("Pattern parse tests complete")
  }
  
  return parsePattern
});
