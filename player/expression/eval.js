'use strict';
define(function(require) {

  let ops = {
    'operator+': (l,r)=>l+r,
    'operator-': (l,r)=>l-r,
    'operator*': (l,r)=>l*r,
    'operator/': (l,r)=>l/r,
    'operator%': (l,r)=>l%r,
  }

  let evalConstants = (e) => {
    let op = ops[e.type]
    if (op) {
      let lhs = evalConstants(e.lhs)
      let rhs = evalConstants(e.rhs)
      if (lhs.eval == 'constant' && rhs.eval == 'constant') {
        return {value:op(lhs.value,rhs.value),eval:'constant',type:'number'}
      }
    }
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

  assert(num(1), evalConstants(num(1)))
  assert(num(1), evalEvent(num(1)))
  assert(num(1), evalFrame(num(1)))

  assert(num(3), evalConstants({type:'operator+',lhs:num(1),rhs:num(2)}))
  assert(num(-1), evalConstants({type:'operator-',lhs:num(1),rhs:num(2)}))
  assert(num(6), evalConstants({type:'operator*',lhs:num(2),rhs:num(3)}))
  assert(num(1/2), evalConstants({type:'operator/',lhs:num(1),rhs:num(2)}))
  assert(num(1), evalConstants({type:'operator%',lhs:num(3),rhs:num(2)}))

  console.log('Eval expression tests complete')

  return {
    evalConstants: evalConstants,
    evalEvent: evalEvent,
    evalFrame: evalFrame,
  }
})