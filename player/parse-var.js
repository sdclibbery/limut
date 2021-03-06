'use strict';
define(function(require) {
  let vars = require('vars')
  let players = require('player/players')
  let parseMap = require('player/parse-map')
  let eatWhitespace = require('player/eat-whitespace')

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
    // look for function call syntax; call var immediately if present
    eatWhitespace(state)
    if (typeof vars[key] === 'function' && state.str.charAt(state.idx).toLowerCase() === '{') {
      let params = parseMap(state)
      return vars[key](params)
    }
    // Return a lookup function
    let [playerId, param] = key.split('.')
    let result = (event,b) => {
      let v
      if (param) {
        let player = players.instances[playerId]
        if (player) {
          let ce = player.currentEvent ? player.currentEvent(event,b) : undefined
          v = (ce ? ce[param] : 0) || 0
        } else if (playerId === 'this') {
          v = event[param]
        } else {
          v = vars[key]
          if (v === undefined) { v = 0 } // If not found as a var, assume its for a currently unavailable player and default to zero
        }
      } else {
        v = vars[key]
      }
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

  vars.foo = 'bar'
  let state = {str:'foo',idx:0}
  p = varLookup(state)
  assert(3, state.idx)
  vars.foo = 'baz'
  assert('baz', p({}))
  delete vars.foo

  vars['foo.woo'] = 'bar'
  p = varLookup({str:'foo.woo',idx:0})
  assert('bar', p({}))
  vars['foo.woo'] = undefined

  vars['foo'] = 'bar'
  p = varLookup({str:'FoO',idx:0})
  assert('bar', p({}))
  delete vars.foo

  players.instances.p1 = { currentEvent:(e,b)=>{ return {foo:b}} }
  p = varLookup({str:'p1.foo',idx:0})
  assert(0, p({},0))
  assert(2, p({},2))
  delete players.instances.p1

  p = varLookup({str:'p1.foo',idx:0})
  assert(0, p({}))

  p = varLookup({str:'this.foo',idx:0})
  assert(1, p({foo:1}))

  vars.foo = () => 3
  state = {str:'foo {}',idx:0}
  p = varLookup(state)
  assert(6, state.idx)
  assert(3, p)
  delete vars.foo

  console.log('Parse var tests complete')
  }
  
  return varLookup
})