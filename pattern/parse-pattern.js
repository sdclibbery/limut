'use strict';
define(function(require) {
  let eatWhitespace = require('expression/eat-whitespace')
  let literal = require('pattern/literal/literal.js')
  let number = require('expression/parse-number.js')

  let operators = [ // HIGHest operator precedence should have LOWest precedence number!
    {
      keyword: 'loop',
      precedence: 1,
      constructor: require('pattern/operator/loop.js'),
      r: 'expression',
    },
    {
      keyword: 'crop',
      precedence: 2,
      constructor: require('pattern/operator/crop.js'),
      r: 'expression',
    },
    {
      keyword: '*',
      precedence: 3,
      constructor: require('pattern/operator/repeat.js'),
      r: 'expression',
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
    switch (state.expect) {
    case 'literal':
      result = literal(state)
      result.src = state.str.slice(startIdx, state.idx).trim()
      state.expect = 'operator' // The only thing that can follow a literal is an operator to act on it
      break;
    case 'operator':
      for (let idx in operators) {
        let op = operators[idx]
        if (keyword(state, op.keyword)) {
          result = Object.assign({}, op)
          if (op.r === 'expression') { state.expect = 'expression' }
          else { state.expect = 'literal' } // Start of RHS pattern
          break
        }
      }
      if (!result) { throw `Invalid pattern: missing operator` }
      result.src = state.str.slice(startIdx, state.idx).trim()
      break;
    case 'expression':
      result = number(state)
      if (result === undefined) { throw `Invalid pattern: bad expression` }
      state.expect = 'operator' // Expression is always RHS so completes a subpattern
      break;
    }
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
    state.expect = 'literal'
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
    assertThrows('Invalid pattern: bad expression', () => parsePattern(st('01 loop foo')))
    assertThrows('Invalid pattern: missing operator', () => parsePattern(st(' loop +')))
    assertThrows('Invalid pattern: Continuation "_" not valid at start of literal', () => parsePattern(st('01 + _3')))

    console.log("Pattern parse tests complete")
  }
  
  return parsePattern
});
