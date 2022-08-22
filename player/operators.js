'use strict';
define(function(require) {

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
  }
  operators['|'].raw = true
  let precedence = {'|':1,'^':2,'%':3,'/':3,'*':3,'-':4,'+':4,} // MUST ALL BE > 0

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

    console.log('operators tests complete')
  }
  return {
    operators: operators,
    precedence: precedence,
  }
})