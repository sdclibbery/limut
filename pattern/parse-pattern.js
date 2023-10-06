'use strict';
define(function(require) {
  let eatWhitespace = require('expression/eat-whitespace')
  let literal = require('pattern/literal/literal.js')

  let operators = [ // HIGHest operator precedence should have LOWest precedence number!
    {
      keyword: 'loop',
      precedence: 1,
      constructor: require('pattern/operator/loop.js'),
    },
    {
      keyword: 'crop',
      precedence: 2,
      constructor: require('pattern/operator/crop.js'),
    },
    {
      keyword: '*',
      precedence: 3,
      constructor: require('pattern/operator/repeat.js'),
    },
    {
      keyword: '+',
      precedence: 4,
      constructor: require('pattern/operator/concat.js'),
    },
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
    for (let idx in operators) {
      let k = operators[idx]
      if (keyword(state, k.keyword)) {
        result = Object.assign({}, k)
        break
      }
    }
    if (!result) {
      result = literal(state)
    }
    result.src = state.str.slice(startIdx, state.idx).trim()
    return result
  }

  let precedenceTree = (elements) => {
    // Build an operator tree back up from a flat list of syntax elements, taking precedence into account
    if (elements.length === 1) { return elements[0] }
    let pivot = -1
    let p = 0
    for (let i=1; i < elements.length; i+=2) {
      let elementP = elements[i].precedence
      if (elementP && elementP >= p) {
        p = elementP
        pivot = i
      }
    }
    let op = elements[pivot]
    if (op === undefined) { throw `Invalid pattern: missing operator` }
    let lhs = precedenceTree(elements.slice(0, pivot))
    if (lhs === undefined) { throw `Invalid pattern: missing argument to operator ${op.keyword}` }
    if (lhs.keyword !== undefined) { throw `Invalid pattern: invalid argument ${lhs.src} to operator ${op.keyword}` }
    let rhs = precedenceTree(elements.slice(pivot+1))
    if (rhs === undefined) { throw `Invalid pattern: missing argument to operator ${op.keyword}` }
    if (rhs.keyword !== undefined) { throw `Invalid pattern: invalid argument ${rhs.src} to operator ${op.keyword}` }
    return op.constructor(lhs, rhs)
  }

  let parsePattern = (state) => {
    let playFromStart = keyword(state, 'now')
    let elements = []
    let element = parseElement(state)
    while (!!element) {
      elements.push(element)
      element = parseElement(state)
    }
    let result = precedenceTree(elements)
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

    assertThrows('Invalid pattern: missing operator', () => parsePattern(st('01 loop')))
    assertThrows('Invalid pattern: missing operator', () => parsePattern(st('loop 1')))
    assertThrows('Invalid pattern: invalid loop count foo to operator loop', () => parsePattern(st('01 loop foo')))
    assertThrows('Invalid pattern: invalid argument loop to operator +', () => parsePattern(st(' loop +')))
    assertThrows('Invalid pattern: invalid argument loop to operator +', () => parsePattern(st('0 + loop')))
    assertThrows('Invalid pattern: Continuation "_" not valid at start of literal', () => parsePattern(st('01 + _3')))

    console.log("Pattern parse tests complete")
  }
  
  return parsePattern
});
