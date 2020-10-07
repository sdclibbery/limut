'use strict';
define(function(require) {
  let operators = require('player/expression/operators')
  let timevars = require('player/expression/timevars')
  let {constant, event, frame} = require('player/expression/eval-intervals')

  let evalConstants = (e) => {
    return operators.eval(e, evalConstants, constant)
      || e
  }

  let evalEvent = (e, b,s) => {
    return operators.eval(e, evalEvent, event, b,s)
      || timevars.eval(e, evalEvent, event, b,s)
      || e
  }

  let evalFrame = (e, b) => {
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
  let op = (op,l,r) => {return {lhs:l, rhs:r, type:'operator'+op}}
  let step = (v,t,d) => {return {value:v, time:t, duration:d}}
  let timevar = (ss,ev) => {ss.totalDuration=ss.reduce((a,b)=>a+b.duration,0); return {steps:ss, eval:ev||event, type:'timevar'}}

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

  assert(num(6), evalConstants(op('+',num(1),op('+',num(2),num(3)))))
  assert(num(19), evalConstants(op('+',op('*',num(1),num(2)),op('+',op('*',num(3),num(4)),num(5)))))

  // Basic timevar
  assert(timevar([step(num(1),0,1),step(num(2),1,1)]), evalConstants(timevar([step(num(1),0,1),step(num(2),1,1)])))
  assert(timevar([step(num(1),0,1),step(num(2),1,1)],frame), evalEvent(timevar([step(num(1),0,1),step(num(2),1,1)],frame), 0, undefined))
  assert(num(1), evalEvent(timevar([step(num(1),0,1),step(num(2),1,1)]), 0, undefined))
  assert(num(1), evalEvent(timevar([step(num(1),0,1),step(num(2),1,1)]), 0.5, undefined))
  assert(num(2), evalEvent(timevar([step(num(1),0,1),step(num(2),1,1)]), 1, undefined))
  assert(num(1), evalEvent(timevar([step(num(1),0,1),step(num(2),1,1)]), 2, undefined))
  assert(num(1), evalFrame(timevar([step(num(1),0,1),step(num(2),1,1)]), 0))
  assert(num(1), evalFrame(timevar([step(num(1),0,1),step(num(2),1,1)],frame), 0))
  assert(none, evalFrame(timevar([step(none,0,4)]), 0))

  // timevars nested with other values 
  assert(num(3), evalEvent(timevar([step(op('+',num(1),num(2)),0,4)]), 0, undefined))
  assert(num(1), evalEvent(timevar([step(timevar([step(num(1),0,1),step(num(2),1,1)]),0,4),step(num(3),4,4)]), 0, undefined))
  assert(num(2), evalEvent(timevar([step(timevar([step(num(1),0,1),step(num(2),1,1)]),0,4),step(num(3),4,4)]), 1, undefined))
  assert(num(1), evalEvent(timevar([step(timevar([step(num(1),0,1),step(num(2),1,1)]),0,4),step(num(3),4,4)]), 2, undefined))
  assert(num(2), evalEvent(timevar([step(timevar([step(num(1),0,1),step(num(2),1,1)]),0,4),step(num(3),4,4)]), 3, undefined))
  assert(num(3), evalEvent(timevar([step(timevar([step(num(1),0,1),step(num(2),1,1)]),0,4),step(num(3),4,4)]), 4, undefined))
  assert(num(1), evalEvent(timevar([step(timevar([step(num(1),0,1),step(num(2),1,1)]),0,4),step(num(3),4,4)]), 8, undefined))
  assert(num(4), evalEvent(op('+',timevar([step(num(1),0,1),step(num(2),1,1)]),num(3)), 0, undefined))
  assert(num(5), evalEvent(op('+',timevar([step(num(1),0,1),step(num(2),1,1)]),num(3)), 1, undefined))
  assert(op('+',timevar([step(num(1),0,1),step(num(2),1,1)],frame),num(3)), evalEvent(op('+',timevar([step(num(1),0,1),step(num(2),1,1)],frame),num(3)), 1, undefined))

  console.log('Eval expression tests complete')

  return {
    evalConstants: evalConstants,
    evalEvent: evalEvent,
    evalFrame: evalFrame,
  }
})