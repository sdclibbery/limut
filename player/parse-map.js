'use strict';
define(function(require) {
  let eatWhitespace = require('player/eat-whitespace')

  let identifier = (state) => {
    let char
    let result = ''
    while (char = state.str.charAt(state.idx).toLowerCase()) {
      if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char === '_') {
        result += char
        state.idx += 1
        continue
      }
      break
    }
    return result
  }

  let parseMapEntry = (state, keys, values) => {
    eatWhitespace(state)
    let tryState = Object.assign({}, state)
    let k = identifier(tryState)
    eatWhitespace(tryState)
    if (k === '' || tryState.str.charAt(tryState.idx) !== ':') {
      // Try parse as keyless value instead
      let v = state.expression(state)
      eatWhitespace(state)
      keys.push('value')
      values.push(v)
        return
    }
    Object.assign(state, tryState)
    state.idx += 1
    eatWhitespace(state)
    let v = state.expression(state)
    eatWhitespace(state)
    keys.push(k)
    values.push(v)
  }

  let buildMap = (vs, keys) => {
    let result = {}
    for (let i=0; i<vs.length; i++) {
      result[keys[i]] = vs[i]
    }
    return result
  }

  let parseMap = (state) => {
    let keys = []
    let values = []
    let char
    eatWhitespace(state)
    if (state.str.charAt(state.idx) !== '{') { return }
    while (char = state.str.charAt(state.idx)) {
      if (char == '{' || char == ',') {
        state.idx += 1
        parseMapEntry(state, keys, values)
      } else if (char == '}') {
        state.idx += 1
        break
      } else {
        return undefined
      }
    }
    return buildMap(values, keys)
  }

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let number = require('player/parse-number') // Expressions should only be numbers in these tests for simplicity

  assert(undefined, parseMap({str:'',idx:0,expression:number}))
  assert(undefined, parseMap({str:'ff',idx:0,expression:number}))
  assert(undefined, parseMap({str:'k:v',idx:0,expression:number}))
  assert(undefined, parseMap({str:'(k:v)',idx:0,expression:number}))
  assert({}, parseMap({str:'{}',idx:0,expression:number}))
  assert({foo:0.5}, parseMap({str:'{foo:1/2}',idx:0,expression:number}))
  assert({foo:0.5}, parseMap({str:'{foo:1/2}',idx:0,expression:number}))
  assert({foo:0.5,bar:-1.5}, parseMap({str:'{foo:1/2,bar:-3/2}',idx:0,expression:number}))
  assert({foo:0.5,bar:-1.5}, parseMap({str:' \t{ \tfoo \t: \t1/2 \t, \tbar \t: \t-3/2 \t} \t',idx:0,expression:number}))
  assert({value:0.5}, parseMap({str:'{1/2}',idx:0,expression:number}))
  assert({value:0.5}, parseMap({str:' \t{ \t1/2 \t} \t',idx:0,expression:number}))
  assert({value:0.5,foo:2}, parseMap({str:'{1/2,foo:2}',idx:0,expression:number}))
  assert({value:0.5,foo:2}, parseMap({str:'{ \t1/2 \t, \tfoo \t: \t2 \t}',idx:0,expression:number}))
  assert({foo:2,value:0.5}, parseMap({str:'{foo:2,1/2}',idx:0,expression:number}))
  assert({value:3,foo:2}, parseMap({str:'{1/2,2,foo:2,3}',idx:0,expression:number}))
  
  console.log('Parse map tests complete')
  }
    
  return parseMap
})