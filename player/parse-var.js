'use strict';
define(function(require) {
  let vars = require('vars')
  let players = require('player/players')
  let {evalParamFrame} = require('player/eval-param')

  let isVarChar = (char) => {
    return (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || (char == '_')
  }

  let parseVar = (state) => {
    let key = ''
    let char
    while (char = state.str.charAt(state.idx).toLowerCase()) {
      if (isVarChar(char)) {
        key += char
        state.idx += 1
        continue
      }
      break
    }
    return key
  }

  let varLookup = (key, args, context) => {
    if (!key) { return }

    // look for static function call; call var immediately if present
    let f = vars[key]
    if (typeof f === 'function' && f.isStaticVarFunction) {
      return f(args, context)
    }

    // Return a lookup function
    let state = {}
    let result = (event,b, evalRecurse, modifiers) => {
      let v
      if (typeof vars[key] === 'function' && vars[key].isVarFunction) { // Var function
        v = vars[key](modifiers, event,b, state)
      } else {
        v = vars[key] // ordinary var
        if (v === undefined) { v = key } // If not found as a var, treat as a string value
      }
      v = evalParamFrame(v,event,b)
      if (v === undefined) { v = 0 } // If not found as a var, assume its for a currently unavailable player and default to zero
      return v
    }
    return result
  }

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  
  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let p
  let ev = (i,c,d) => {return{idx:i,count:c,dur:d}}

  vars.foo = 'bar'
  let state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [])
  assert(3, state.idx)
  vars.foo = 'baz'
  assert('baz', p({},0,(v)=>v))
  delete vars.foo

  vars['foo'] = 'bar'
  p = varLookup(parseVar({str:'FoO',idx:0}), [])
  assert('bar', p({},0,(v)=>v))
  delete vars.foo

  vars.foo = () => 3
  vars.foo.isVarFunction = true
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [], {})
  assert(3, state.idx)
  assert(3, p(ev(0,0),0,evalParamFrame))
  delete vars.foo

  vars.foo = () => [1,2]
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [])
  assert([1,2], p(ev(0),0,evalParamFrame))
  delete vars.foo

  vars.foo = () => [1]
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [])
  assert([1], p(ev(0),0,evalParamFrame))
  delete vars.foo

  vars.foo = () => []
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [])
  assert([], p(ev(0),0,evalParamFrame))
  delete vars.foo

  vars.foo = () => undefined
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [])
  assert(0, p(ev(0),0,evalParamFrame))
  delete vars.foo

  vars.foo = (x) => x.value*x.value
  vars.foo.isVarFunction = true
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [])
  p.modifiers = {value:2}
  assert(4, evalParamFrame(p,ev(0),0))
  delete vars.foo

  vars.foo = (x) => x.value*x.value
  vars.foo.isVarFunction = true
  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [])
  p.modifiers = {value:[2,3]}
  assert([4,9], evalParamFrame(p,ev(0),0))
  delete vars.foo

  state = {str:'foo',idx:0}
  p = varLookup(parseVar(state), [])
  assert('foo', p(ev(0),0,evalParamFrame))

  console.log('Parse var tests complete')
  }
  
  return {
    parseVar: parseVar,
    varLookup: varLookup,
    isVarChar: isVarChar,
  }
})