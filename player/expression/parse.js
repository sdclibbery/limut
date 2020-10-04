'use strict';
define(function(require) {
  let number = require('player/parse-number')

  let expression = (state) => {
    // console.log('expression', state)
    let result = {eval:'constant', type:'undefined'}
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
      // number
      let n = number(state)
      if (n !== undefined) {
        result = {value: n, eval: 'constant', type: 'number' }
        // console.log('number', result, state)
        continue
      }
      break
    }
    return result
  }
  
  let parseExpression = (v, commented) => {
    if (v == '' || v == undefined) { return {eval:'constant',type:'undefined'} }
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

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let assertCommented = (expected, str) => {
    let commented = false
    assert(expected, parseExpression(str, ()=>commented=true))
    assert(true, commented)
  }

  assert({eval:'constant',type:'undefined'}, parseExpression())
  assert({eval:'constant',type:'undefined'}, parseExpression(''))
  assertCommented({eval:'constant',type:'undefined'}, '//')

  assert({value:1, eval:'constant',type:'number'}, parseExpression('1'))
  assert({value:-1.1, eval:'constant',type:'number'}, parseExpression('-1.1'))
  assert({value:0.5, eval:'constant',type:'number'}, parseExpression('1/2'))
  assertCommented({eval:'constant',type:'undefined'}, '//1')
  assertCommented({value:1, eval:'constant',type:'number'}, '1//')

  console.log('Parse expression tests complete')

  return parseExpression
})