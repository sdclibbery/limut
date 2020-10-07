'use strict';
define(function(require) {
  let operators = require('player/expression/operators')
  let timevars = require('player/expression/timevars')
  let {constant, event, frame, intervalLte} = require('player/expression/eval-intervals')

  let evalConstants = (e) => {
    if (!intervalLte(e.eval, constant)) { e }
    return operators.eval(e, evalConstants, constant)
      || e
  }

  let evalEvent = (e, b,s) => {
    if (!intervalLte(e.eval, event)) { e }
    return operators.eval(e, evalEvent, event, b,s)
      || timevars.eval(e, evalEvent, event, b,s)
      || e
  }

  let evalFrame = (e, b) => {
    if (!intervalLte(e.eval, frame)) { e }
    return operators.eval(e, evalFrame, frame, b)
      || timevars.eval(e, evalFrame, frame, b)
      || e
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  let none = {eval:constant,type:'undefined'}
  let num = (n,ev) => {return {value:n, eval:ev||constant,type:'number'}}
  let op = (op,l,r,ev) => {return {lhs:l, rhs:r, eval:ev||constant, type:'operator'+op}}
  let step = (v,t,d) => {return {value:v, time:t, duration:d}}
  let timevar = (ss,ev) => {ss.totalDuration=ss.reduce((a,b)=>a+b.duration,0); return {steps:ss, eval:ev||event, type:'timevar'}}

  let parseExpression = require('player/expression/parse')

  assert(none, evalConstants(none))
  assert(none, evalEvent(none))
  assert(none, evalFrame(none))

  assert(num(1), evalConstants(num(1)))
  assert(num(1), evalEvent(num(1)))
  assert(num(1), evalFrame(num(1)))

  assert(num(3), evalConstants(op('+',num(1),num(2))))
  assert(num(-1), evalConstants(op('-',num(1),num(2))))
  assert(num(6), evalConstants(op('*',num(2),num(3))))
  assert(num(1/2), evalConstants(op('/',num(1),num(2))))
  assert(num(1), evalConstants(op('%',num(3),num(2))))

  assert(num(3), evalEvent(op('+',num(1),num(2))))
  assert(num(3), evalFrame(op('+',num(1),num(2))))

  assert(num(6), evalConstants(parseExpression('1+2+3')))
  assert(num(19), evalConstants(parseExpression('1*2+3*4+5')))

  assert(timevar([step(num(1),0,1),step(num(2),1,1)]), evalConstants(timevar([step(num(1),0,1),step(num(2),1,1)])))
  assert(timevar([step(num(1),0,1),step(num(2),1,1)],frame), evalEvent(timevar([step(num(1),0,1),step(num(2),1,1)],frame), 0, undefined))
  assert(num(1), evalEvent(timevar([step(num(1),0,1),step(num(2),1,1)]), 0, undefined))
  assert(num(1), evalEvent(timevar([step(num(1),0,1),step(num(2),1,1)]), 0.5, undefined))
  assert(num(2), evalEvent(timevar([step(num(1),0,1),step(num(2),1,1)]), 1, undefined))
  assert(num(1), evalEvent(timevar([step(num(1),0,1),step(num(2),1,1)]), 2, undefined))
  assert(num(1), evalFrame(timevar([step(num(1),0,1),step(num(2),1,1)]), 0))
  assert(num(1), evalFrame(timevar([step(num(1),0,1),step(num(2),1,1)],frame), 0))
  assert(none, evalFrame(timevar([step(none,0,4)]), 0))

  assert(num(3), evalEvent(parseExpression('[1+2]t'), 0, undefined))
  assert(num(1), evalEvent(parseExpression('[[1,2]t1,3]t'), 0, undefined))
  assert(num(2), evalEvent(parseExpression('[[1,2]t1,3]t'), 1, undefined))
  assert(num(1), evalEvent(parseExpression('[[1,2]t1,3]t'), 2, undefined))
  assert(num(2), evalEvent(parseExpression('[[1,2]t1,3]t'), 3, undefined))
  assert(num(3), evalEvent(parseExpression('[[1,2]t1,3]t'), 4, undefined))
  assert(num(1), evalEvent(parseExpression('[[1,2]t1,3]t'), 8, undefined))
  assert(num(4), evalEvent(parseExpression('[1,2]t1+3'), 0, undefined))
  assert(num(5), evalEvent(parseExpression('[1,2]t1+3'), 1, undefined))
  assert(parseExpression('[1,2]t1@f+3'), evalEvent(parseExpression('[1,2]t1@f+3'), 0, undefined))

  console.log('Eval expression tests complete')

  return {
    evalConstants: evalConstants,
    evalEvent: evalEvent,
    evalFrame: evalFrame,
  }
})