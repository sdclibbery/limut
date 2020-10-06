'use strict';
define(function(require) {
  let operators = require('player/expression/operators')
  let {constant, event, frame} = require('player/expression/eval-intervals')

  let evalConstants = (e) => {
    let result
    result = operators.eval(e, evalConstants, constant)
    if (result) { return result }
    return e
  }

  let evalEvent = (e, s,b) => {
    let result
    result = operators.eval(e, evalEvent, event)
    if (result) { return result }
    return e
  }

  let evalFrame = (e, b) => {
    let result
    result = operators.eval(e, evalFrame, frame)
    if (result) { return result }
    return e
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  let num = (n,ev) => {return {value:n, eval:ev||constant,type:'number'}}
  let op = (op,l,r) => {return {lhs:l, rhs:r, type:'operator'+op}}

  assert(num(1), evalConstants(num(1)))
  assert(num(1), evalEvent(num(1)))
  assert(num(1), evalFrame(num(1)))

  assert(num(3), evalConstants(op('+',num(1),num(2))))
  assert(num(-1), evalConstants(op('-',num(1),num(2))))
  assert(num(6), evalConstants(op('*',num(2),num(3))))
  assert(num(1/2), evalConstants(op('/',num(1),num(2))))
  assert(num(1), evalConstants(op('%',num(3),num(2))))

  assert({value:3,eval:event,type:'number'}, evalEvent(op('+',num(1),num(2))))
  assert({value:3,eval:frame,type:'number'}, evalFrame(op('+',num(1),num(2))))

  assert(num(6), evalConstants(op('+',num(1),op('+',num(2),num(3)))))
  assert(num(19), evalConstants(op('+',op('*',num(1),num(2)),op('+',op('*',num(3),num(4)),num(5)))))
  
  console.log('Eval expression tests complete')

  return {
    evalConstants: evalConstants,
    evalEvent: evalEvent,
    evalFrame: evalFrame,
  }
})