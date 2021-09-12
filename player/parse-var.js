'use strict';
define(function(require) {
  let vars = require('vars')
  let players = require('player/players')
  let parseMap = require('player/parse-map')
  let parseArray = require('player/parse-array')
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
    // Look for a tuple indexer
    eatWhitespace(state)
    let tupleIndices = parseArray(state, '[', ']')
    // Return a lookup function
    let [playerId, param] = key.split('.')
    if (playerId && param) {
      state.dependsOn.push(playerId)
    }
    let result = (event,b,evalRecurse) => {
      let v
      if (param) {
        let player = players.instances[playerId]
        if (player) {
          let es = player.currentEvent(event, b)
          v = es.map(e => e[param])
        } else if (playerId === 'this') {
          v = event[param]
        } else {
          v = vars[key]
        }
      } else {
        v = vars[key]
      }
      v = evalRecurse(v,event,b,evalRecurse)
      if (Array.isArray(v)) {
        if (tupleIndices.length > 0) { // extract required elements only from tuple
          if (tupleIndices.separator === ':') {
            let vn = []
            for (let i = Math.floor(tupleIndices[0]); i <= Math.floor(tupleIndices[1]); i++) {
              vn.push(v[i % v.length])
            }
            v = vn
          } else {
            v = tupleIndices.map(i => v[i % v.length])
          }
        }
        if (v.length === 1) { v = v[0] }
        if (v.length === 0) { v = 0 }
      }
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
  let {evalParamFrame,evalParamEvent} = require('player/eval-param')
  let parseNumber = require('player/parse-number')
  let ev = (i,c,d) => {return{idx:i,count:c,dur:d}}

  vars.foo = 'bar'
  let state = {str:'foo',idx:0,dependsOn:[]}
  p = varLookup(state)
  assert(3, state.idx)
  vars.foo = 'baz'
  assert('baz', p({},0,(v)=>v))
  delete vars.foo

  vars['foo.woo'] = 'bar'
  p = varLookup({str:'foo.woo',idx:0,dependsOn:[]})
  assert('bar', p({},0,(v)=>v))
  vars['foo.woo'] = undefined

  vars['foo'] = 'bar'
  p = varLookup({str:'FoO',idx:0,dependsOn:[]})
  assert('bar', p({},0,(v)=>v))
  delete vars.foo

  players.instances.p1 = { currentEvent:(e,b)=>{ return [{foo:b}]} }
  p = varLookup({str:'p1.foo',idx:0,dependsOn:[]})
  assert(0, p({},0,(v)=>v))
  assert(2, p({beat:2},2,(v)=>v))
  delete players.instances.p1

  p = varLookup({str:'p1.foo',idx:0,dependsOn:[]})
  assert(0, p({},0,(v)=>v))

  p = varLookup({str:'this.foo',idx:0,dependsOn:[]})
  assert(1, p({foo:1},0,(v)=>v))

  vars.foo = () => 3
  state = {str:'foo {}',idx:0}
  p = varLookup(state)
  assert(6, state.idx)
  assert(3, p)
  delete vars.foo

  let s = {str:'foo.bar',idx:0,dependsOn:[]}
  varLookup(s)
  assert(['foo'], s.dependsOn)

  vars.foo = () => [1,2]
  state = {str:'foo',idx:0}
  p = varLookup(state)
  assert([1,2], p(ev(0),0,evalParamFrame))
  delete vars.foo

  vars.foo = () => [1]
  state = {str:'foo',idx:0}
  p = varLookup(state)
  assert(1, p(ev(0),0,evalParamFrame))
  delete vars.foo

  vars.foo = () => []
  state = {str:'foo',idx:0}
  p = varLookup(state)
  assert(0, p(ev(0),0,evalParamFrame))
  delete vars.foo

  vars.foo = () => undefined
  state = {str:'foo',idx:0}
  p = varLookup(state)
  assert(0, p(ev(0),0,evalParamFrame))
  delete vars.foo

  vars.foo = () => [2,3]
  state = {str:'foo[0]',idx:0,expression:parseNumber}
  p = varLookup(state)
  assert(2, p(ev(0),0,evalParamFrame))
  delete vars.foo

  vars.foo = () => 2
  state = {str:'foo[0]',idx:0,expression:parseNumber}
  p = varLookup(state)
  assert(2, p(ev(0),0,evalParamFrame))
  delete vars.foo

  players.instances.p1 = { currentEvent:(e,b)=>{ return [{foo:[2,3]}]} }
  p = varLookup({str:'p1.foo[0]',idx:0,dependsOn:[],expression:parseNumber})
  assert(2, p(ev(0),0,evalParamFrame))
  delete players.instances.p1

  vars.foo = [2,3]
  state = {str:'foo[0]',idx:0,expression:parseNumber}
  p = varLookup(state)
  assert(2, p(ev(0),0,evalParamFrame))
  delete vars.foo

  vars.foo = () => [2,3,4]
  state = {str:'foo[0,2]',idx:0,expression:parseNumber}
  p = varLookup(state)
  assert([2,4], p(ev(0),0,evalParamFrame))
  delete vars.foo

  vars.foo = () => [2,3,4]
  state = {str:'foo[0:2]',idx:0,expression:parseNumber}
  p = varLookup(state)
  assert([2,3,4], p(ev(0),0,evalParamFrame))
  delete vars.foo

  console.log('Parse var tests complete')
  }
  
  return varLookup
})