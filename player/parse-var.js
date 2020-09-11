'use strict';
define(function(require) {
  let evalParam = require('player/eval-param')
  let vars = require('vars')

  let varLookup = (state) => {
    let key = ''
    let char
    while (char = state.str.charAt(state.idx).toLowerCase()) {
      if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || (char == '_') || (char == '.')) {
        key += char
        state.idx += 1
        continue
      }
      break
    }
    if (!key) { return }
    return (s,b) => {
      return evalParam(vars[key] ,s,b)
    }
  }

  // TESTS

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let p

  vars.foo = 'bar'
  let state = {str:'foo',idx:0}
  p = varLookup(state)
  assert(3, state.idx)
  vars.foo = 'baz'
  assert('baz', p())
  vars.foo = undefined

  vars['foo.woo'] = 'bar'
  p = varLookup({str:'foo.woo',idx:0})
  assert('bar', p())
  vars['foo.woo'] = undefined

  vars['foo'] = 'bar'
  p = varLookup({str:'FoO',idx:0})
  assert('bar', p())
  vars['foo'] = undefined

  console.log('Parse var tests complete')

  return varLookup
})