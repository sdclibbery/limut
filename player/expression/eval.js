'use strict';
define(function(require) {

  let ops = {
    'operator+': (l,r)=>l+r,
    'operator-': (l,r)=>l-r,
    'operator*': (l,r)=>l*r,
    'operator/': (l,r)=>l/r,
    'operator%': (l,r)=>l%r,
  }

  let opEval = (e, recurse) => {
    let op = ops[e.type]
    if (op) {
      let lhs = recurse(e.lhs)
      let rhs = recurse(e.rhs)
      if (lhs.eval == 'constant' && rhs.eval == 'constant') {
        return {value:op(lhs.value,rhs.value),eval:'constant',type:'number'}
      }
    }
  }

  let evalConstants = (e) => {
    let result
    result = opEval(e, evalConstants)
    if (result) { return result }
    return e
  }

  let evalEvent = (e, s,b) => {
    return e
  }

  let evalFrame = (e, b) => {
    return e
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  let num = (n,ev) => {return {value:n, eval:ev||'constant',type:'number'}}
  let op = (op,l,r) => {return {type:'operator'+op, lhs:l, rhs:r}}

  assert(num(1), evalConstants(num(1)))
  assert(num(1), evalEvent(num(1)))
  assert(num(1), evalFrame(num(1)))

  assert(num(3), evalConstants(op('+',num(1),num(2))))
  assert(num(-1), evalConstants(op('-',num(1),num(2))))
  assert(num(6), evalConstants(op('*',num(2),num(3))))
  assert(num(1/2), evalConstants(op('/',num(1),num(2))))
  assert(num(1), evalConstants(op('%',num(3),num(2))))

  assert(num(6), evalConstants(op('+',num(1),op('+',num(2),num(3)))))
  assert(num(19), evalConstants(op('+',op('*',num(1),num(2)),op('+',op('*',num(3),num(4)),num(5)))))
  
  console.log('Eval expression tests complete')

  return {
    evalConstants: evalConstants,
    evalEvent: evalEvent,
    evalFrame: evalFrame,
  }
})