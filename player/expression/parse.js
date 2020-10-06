'use strict';
define(function(require) {
  let number = require('player/parse-number')
  let operators = require('player/expression/operators')
  let {array,expandColon,numberOrArrayOrFour} = require('player/expression/parse-arrays')
  let {constant, event, frame} = require('player/expression/eval-intervals')

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
        result = frame
      } else if (state.str.charAt(state.idx) == 'e') {
        state.idx += 1
        result = event
      }
    }
    return result
  }

  let expression = (state) => {
    let expr = {eval:constant, type:'undefined'}
    let operatorList = []
    let char
    while (char = state.str.charAt(state.idx)) {
      // whitespace
      if (char === '') { break }
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') { state.idx += 1; continue }
      // comment
      if (char === '/' && state.str.charAt(state.idx+1) === '/') {
        state.idx = state.str.length
        state.commented = true
        break
      }
      // array / time var / random
      if (char == '[') {
        let vs = array(state, '[', ']', expression)
        if (state.str.charAt(state.idx).toLowerCase() == 't') {
          state.idx += 1
          expr = {
            values: expandColon(vs),
            durations: numberOrArrayOrFour(state),
            eval: parseEval(state) || event,
            type: 'timevar',
          }
          }
        continue
      }
      // operator
      if (expr.type !== 'undefined') {
        if (operators.list.includes(char)) {
          state.idx += 1
          eatWhitespace(state)
          operatorList.push(expr)
          expr = {eval:constant, type:'undefined'}
          operatorList.push(char)
          operators.flatten(operatorList, expression(state))
          continue
        }
      }
      // number
      let n = number(state)
      if (n !== undefined) {
        expr = {value: n, eval: constant, type: 'number' }
        parseEval(state)
        continue
      }
      break
    }
    if (operatorList.length > 0) {
      expr = operators.precedence(operatorList)
    }
    return expr
  }
  
  let parseExpression = (v, commented) => {
    if (v == '' || v == undefined) { return {eval:constant,type:'undefined'} }
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

  let num = (n) => {return {value:n, eval:constant,type:'number'}}
  let op = (op,l,r) => {return {lhs:l, rhs:r, type:'operator'+op}}

  assert({eval:constant,type:'undefined'}, parseExpression())
  assert({eval:constant,type:'undefined'}, parseExpression(''))
  assertCommented({eval:constant,type:'undefined'}, '//')

  assert(num(1), parseExpression('1'))
  assert(num(-1.1), parseExpression('-1.1'))
  assert(num(0.5), parseExpression('1/2'))
  assert(num(0.123), parseExpression('.123'))
  assert(num(1e9), parseExpression('1e9'))
  assert(num(1), parseExpression('1@e'))
  assert(num(1), parseExpression('1@f'))
  assertCommented({eval:constant,type:'undefined'}, '//1')
  assertCommented(num(1), '1//')

  assert(op('+',num(1),num(2)), parseExpression('1+2'))
  assert(op('+',num(1),num(2)), parseExpression('1@e+2@f'))
  assert(op('+',num(1),num(2)), parseExpression(' 1 + 2 '))
  assert(op('+',num(-0.5),num(1.5)), parseExpression('-1/2+1.5'))
  assert(op('*',num(1),num(2)), parseExpression('1*2'))
  assert(op('/',num(1),num(2)), parseExpression('1 / 2'))
  assert(op('-',num(1),num(2)), parseExpression('1-2'))
  assert(op('%',num(1),num(2)), parseExpression('1%2'))

  assert(op('+',num(1),op('+',num(2),num(3))), parseExpression('1+2+3'))
  assert(op('+',num(1),op('*',num(2),num(3))), parseExpression('1+2*3'))
  assert(op('+',op('*',num(1),num(2)),num(3)), parseExpression('1*2+3'))
  assert(op('+',op('*',num(1),num(2)),op('+',op('*',num(3),num(4)),num(5))), parseExpression('1*2+3*4+5'))

  assert({values:[num(1),num(2)],durations:1,eval:event,type:'timevar'}, parseExpression('[1,2]t1'))

  console.log('Parse expression tests complete')

  return parseExpression
})