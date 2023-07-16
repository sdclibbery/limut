'use strict';
define(function(require) {
  let patternLiteral = require('pattern/pattern-literal.js')
  let loopOperator = require('pattern/loop-operator.js')

  let parsePattern = (patternStr, params) => {
    patternStr = patternStr.trim()
    if (!patternStr) { return () => [] }
    let state = {
      str: patternStr,
      idx: 0,
    }
    let literal = patternLiteral(state, params)
    let loop = loopOperator(state, literal)
    if (loop) { return loop }
    return literal
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual, msg) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`+(!!msg?'\n'+msg:'')) }
    }
  
    let pattern, tc

    tc = {}
    pattern = parsePattern('x', {})
    assert([{value:'x',idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
    assert([{value:'x',idx:1,_time:0,dur:1,count:1}], pattern(1, tc))
    assert([{value:'x',idx:2,_time:0,dur:1,count:2}], pattern(2, tc))

    tc = {}
    pattern = parsePattern('x loop 1', {})
    assert([{value:'x',idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
    assert([], pattern(1, tc))
    assert([], pattern(2, tc))

    tc = {}
    pattern = parsePattern('x loop 2', {})
    assert([{value:'x',idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
    assert([{value:'x',idx:1,_time:0,dur:1,count:1}], pattern(1, tc))
    assert([], pattern(2, tc))

    tc = {}
    pattern = parsePattern('xo loop 1', {})
    assert([{value:'x',idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
    assert([{value:'o',idx:1,_time:0,dur:1,count:1}], pattern(1, tc))
    assert([], pattern(2, tc))

    tc = {}
    pattern = parsePattern('xo loop 1', {})
    assert([{value:'o',idx:1,_time:0,dur:1,count:1}], pattern(1, tc))
    assert([], pattern(2, tc))

    tc = {}
    pattern = parsePattern('x loop 1', {dur:1/2})
    assert([{value:'x',idx:0,_time:0,dur:1/2,count:0}], pattern(0, tc))
    assert([], pattern(1, tc))

    console.log("Pattern tests complete")
  }

  return parsePattern
  
})