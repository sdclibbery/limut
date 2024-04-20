'use strict';
define(function(require) {
  let lookupOp = require('expression/lookupOp')

  let defaultUndefined = (op, l,r) => {
    if (l === undefined) { l = 0 }
    if (r === undefined) { r = 0 }
    let result = op(l,r)
    if (typeof result === 'string') { return result }
    return !Number.isFinite(result) ? 0 : result // Don't allow infinities
  }

  let defaultOp = (l,r) => {
    if (l === undefined) { return r }
    return l
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
    '+': (l,r)=>defaultUndefined((l,r)=>l+r, l,r),
    '-': (l,r)=>defaultUndefined((l,r)=>l-r, l,r),
    '*': (l,r)=>defaultUndefined((l,r)=>l*r, l,r),
    '/': (l,r)=>defaultUndefined((l,r)=>(l/r), l,r),
    '%': (l,r)=>defaultUndefined((l,r)=>l%r, l,r),
    '^': (l,r)=>defaultUndefined((l,r)=>Math.pow(l,r), l,r),
    '|': (l,r)=>concatOp(l,r),
    '.': (l,r, e,b,er)=>lookupOp(l,r, e,b,er),
    '?': (l,r)=>defaultOp(l,r),
  }
  operators['|'].raw = true
  operators['.'].raw = true
  operators['.'].doNotEvalDelayed = true
  let precedence = {'.':1,'?':2,'|':3,'^':4,'%':5,'/':5,'*':5,'-':6,'+':6,} // MUST ALL BE > 0

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }

    assert(3, operators['+'](1,2))
    assert('12', operators['+']('1','2'))
    assert(1, operators['+'](1,undefined))
    assert(2, operators['+'](undefined,2))
    assert(0, operators['+'](undefined,undefined))

    assert(6, operators['*'](2,3))
    assert(0, operators['*'](2,undefined))
    assert(0, operators['*'](undefined,3))
    assert(0, operators['*'](undefined,undefined))

    assert(2/3, operators['/'](2,3))
    assert(0, operators['/'](2,undefined))
    assert(0, operators['/'](undefined,3))
    assert(0, operators['/'](undefined,undefined))

    assert(1, operators['%'](3,2))
    assert(0, operators['%'](2,undefined))
    assert(0, operators['%'](undefined,3))
    assert(0, operators['%'](undefined,undefined))

    assert(8, operators['^'](2,3))
    assert(0, operators['^'](-1,1/2))
    assert(1, operators['^'](2,undefined))
    assert(0, operators['^'](undefined,3))
    assert(1, operators['^'](undefined,undefined))

    assert([1,2,3,4], concatOp([1,2], [3,4]))
    assert([1,2,3], concatOp([1,2], 3))
    assert([1,3,4], concatOp(1, [3,4]))
    assert([1,2], concatOp(1, 2))
    assert([1], concatOp(1, undefined))

    assert(1, defaultOp(1, 2))
    assert(1, defaultOp(1, undefined))
    assert(2, defaultOp(undefined, 2))
    assert(undefined, defaultOp(undefined, undefined))
    assert(0, defaultOp(0, 2))

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