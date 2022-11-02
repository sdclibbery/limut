'use strict';
define(function(require) {

  let lookupOp = (l,r) => {
    if (l === undefined) { return undefined }
    if (r === undefined) { return l }
    if (Array.isArray(l)) {
      return l[Math.floor(r % l.length)]
    }
    if (typeof l === 'object') {
      return l[r]      
    }
    return l
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }

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

    console.log('lookupOp tests complete')
  }
  return lookupOp
})