'use strict';
define(function(require) {
  let lookupOp = require('player/lookupOp')

  let ignoreUndefined = (op, l,r) => {
    if (l === undefined) { return r }
    if (r === undefined) { return l }
    return op(l,r)
  }

  let concatOp = (l,r) => {
    if (l === undefined) { return [r] }
    if (r === undefined) { return [l] }
    if (Array.isArray(l)) {
      return l.concat(r)
    }
    if (Array.isArray(r)) {
      return [l].concat(r)
    }
    return [l,r]
  }

  let operators = {
    '+': (l,r)=>ignoreUndefined((l,r)=>l+r, l,r),
    '-': (l,r)=>ignoreUndefined((l,r)=>l-r, l,r),
    '*': (l,r)=>ignoreUndefined((l,r)=>l*r, l,r),
    '/': (l,r)=>ignoreUndefined((l,r)=>l/r, l,r),
    '%': (l,r)=>ignoreUndefined((l,r)=>l%r, l,r),
    '^': (l,r)=>ignoreUndefined((l,r)=>(Math.pow(l,r) || 0), l,r),
    '|': (l,r)=>concatOp(l,r),
    '.': (l,r)=>lookupOp(l,r),
  }
  operators['|'].raw = true
  operators['.'].raw = true
  let precedence = {'.':1,'|':2,'^':3,'%':4,'/':4,'*':4,'-':5,'+':5,} // MUST ALL BE > 0

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }

    assert([1,2,3,4], concatOp([1,2], [3,4]))
    assert([1,2,3], concatOp([1,2], 3))
    assert([1,3,4], concatOp(1, [3,4]))
    assert([1,2], concatOp(1, 2))
    assert([1], concatOp(1, undefined))

    assert(undefined, lookupOp())
    assert(1, lookupOp(1, undefined))
    assert(undefined, lookupOp(undefined, 1))
    assert(2, lookupOp([1,2], 1))
    assert(2, lookupOp([1,2], 1.5))
    assert(1, lookupOp([1,2], 2))
    assert([2,3], lookupOp([1,[2,3]], 1))
    assert(1, lookupOp({v:1}, 'v'))
    assert({b:1}, lookupOp({a:{b:1}}, 'a'))
    assert(1, lookupOp(lookupOp({a:{b:1}}, 'a'), 'b'))

    console.log('operators tests complete')
  }
  return {
    operators: operators,
    precedence: precedence,
  }
})