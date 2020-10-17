'use strict';
define(function(require) {
  let number = require('player/parse-number')

  let array = (state) => {
    let result = []
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char == '[') {
        state.idx += 1
        let v = expression(state)
        if (v !== undefined) { result.push(v) }
      } else if (char == ',') {
        state.idx += 1
        let v = expression(state)
        if (v !== undefined) { result.push(v) }
      } else if (char == ']') {
        state.idx += 1
        break
      } else {
        return undefined
      }
    }
    // console.log('doArray', result, state)
    return result
  }

  let expression = (state) => {
    // console.log('expression', state)
    let lhs = undefined
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === '') { break }
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') { state.idx += 1; continue }
      if (char === '/' && state.str.charAt(state.idx+1) === '/') {
        // comment
        state.idx = state.str.length
        state.commented = true
        break
      }
      // array
      if (char == '[') {
        let vs = array(state, '[', ']')
        lhs = vs
        continue
      }
      // operator
      if (lhs !== undefined) {
        if (char == '/') {
          state.idx += 1
          let rhs = expression(state)
          // console.log('operator/', lhs, rhs, state)
          return lhs.map(v => v/rhs)
        }
        if (char == '*') {
          state.idx += 1
          let rhs = expression(state)
          // console.log('operator*', lhs, rhs, state)
          return lhs.map(v => v*rhs)
        }
      }
      // number
      let n = number(state)
      if (n !== undefined) {
        lhs = n
        // console.log('number', lhs, state)
        continue
      }
      break
    }
    return lhs
  }

  let parseDur = (v, commented) => {
    if (v == '' || v == undefined) { return }
    // console.log('*** parseExpression', v)
    v = v.trim()
    let state = {
      str: v,
      idx: 0,
    }
    let result = expression(state)
    if (commented && state.commented) { commented() }
    return result
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  assert(undefined, parseDur())
  assert(undefined, parseDur(''))
  assert(1/2, parseDur('1/2'))
  assert([], parseDur('[]'))
  assert([1], parseDur('[1]'))
  assert([1/2], parseDur('[1/2]'))
  assert([1,2], parseDur('[1,2]'))
  assert([3/4,3/4,1/2], parseDur('[3,3,2]/4'))
  assert([12,12,8], parseDur('[3,3,2]*4'))

  console.log("Parse dur tests complete")
  }
  
  return parseDur
});
