'use strict';
define(function(require) {
  let number = require('player/parse-number')

  let eatWhitespace = (state) => {
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') { state.idx += 1; continue }
      break
    }
  }

  let parseEval = (state) => {
    eatWhitespace(state)
    let result
    if (state.str.charAt(state.idx) == '@') {
      state.idx += 1
      if (state.str.charAt(state.idx) == 'f') {
        state.idx += 1
        result = 'frame'
      } else if (state.str.charAt(state.idx) == 'e') {
        state.idx += 1
        result = 'event'
      }
    }
    return result
  }

  let parseOperators = (ops) => {
    return {
      type: 'operator'+ops[1],
      lhs:ops[0],
      rhs:ops[2],
    }
  }

  let expression = (state) => {
    let expr = {eval:'constant', type:'undefined'}
    let operatorList = []
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
      // operator
      if (expr.type !== 'undefined') {
        if (['+','-','*','/'].includes(char)) {
          state.idx += 1
          eatWhitespace(state)
          operatorList.push(expr)
          expr = {eval:'constant', type:'undefined'}
          operatorList.push(char)
          operatorList.push(expression(state))
          continue
        }
      }
      // number
      let n = number(state)
      if (n !== undefined) {
        expr = {value: n, eval: 'constant', type: 'number' }
        continue
      }
      break
    }
    if (operatorList.length > 0) {
      expr = parseOperators(operatorList)
    }
    expr.eval = parseEval(state) || expr.eval
    return expr
  }
  
  let parseExpression = (v, commented) => {
    if (v == '' || v == undefined) { return {eval:'constant',type:'undefined'} }
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

  let num = (n) => {return {value:n, eval:'constant',type:'number'}}

  assert({eval:'constant',type:'undefined'}, parseExpression())
  assert({eval:'constant',type:'undefined'}, parseExpression(''))
  assertCommented({eval:'constant',type:'undefined'}, '//')

  assert(num(1), parseExpression('1'))
  assert(num(-1.1), parseExpression('-1.1'))
  assert(num(0.5), parseExpression('1/2'))
  assert({value:1, eval:'event',type:'number'}, parseExpression('1@e'))
  assert({value:1, eval:'frame',type:'number'}, parseExpression('1@f'))
  assertCommented({eval:'constant',type:'undefined'}, '//1')
  assertCommented(num(1), '1//')

  assert({type:'operator+',lhs:num(1),rhs:num(2)}, parseExpression('1+2'))
  assert({type:'operator+',lhs:num(1),rhs:num(2)}, parseExpression(' 1 + 2 '))
  assert({type:'operator+',lhs:num(-0.5),rhs:num(1.5)}, parseExpression('-1/2+1.5'))
  assert({type:'operator*',lhs:num(1),rhs:num(2)}, parseExpression('1*2'))
  assert({type:'operator/',lhs:num(1),rhs:num(2)}, parseExpression('1 / 2'))
  assert({type:'operator-',lhs:num(1),rhs:num(2)}, parseExpression('1-2'))

  console.log('Parse expression tests complete')

  return parseExpression
})