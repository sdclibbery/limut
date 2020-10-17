'use strict';
define(function(require) {
  let vars = require('vars')
  let players = require('player/players')

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
    let result = (event,b) => {
      let [playerId, param] = key.split('.')
      let v
      if (param) {
        let player = players.instances[playerId]
        if (player) {
          v = player.currentEvent ? player.currentEvent(event,b)[param] : 0
        } else {
          v = vars[key]
          if (v === undefined) { v = 0 } // If not found as a var, assume its for a currently unavailable player and default to zero
        }
      } else {
        v = vars[key]
      }
      return v
    }
    let v = result(0,0)
    result.interval = v && v.interval
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
  assert('baz', p())
  delete vars.foo

  vars['foo.woo'] = 'bar'
  p = varLookup({str:'foo.woo',idx:0})
  assert('bar', p())
  vars['foo.woo'] = undefined

  vars['foo'] = 'bar'
  p = varLookup({str:'FoO',idx:0})
  assert('bar', p())
  delete vars.foo

  players.instances.p1 = { currentEvent:(e,b)=>{ return {foo:b}} }
  p = varLookup({str:'p1.foo',idx:0})
  assert(0, p({},0))
  assert(2, p({},2))
  delete players.instances.p1

  p = varLookup({str:'p1.foo',idx:0})
  assert(0, p())

  vars['foo'] = {interval:'event'}
  p = varLookup({str:'foo',idx:0})
  assert('event', p.interval)
  delete vars.foo

  console.log('Parse var tests complete')
  }
  
  return varLookup
})