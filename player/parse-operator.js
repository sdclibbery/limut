'use strict';
define(function(require) {
  let evalOperator = require('player/eval-operator')

  let operators = {
    '+': (l,r)=>l+r,
    '-': (l,r)=>l-r,
    '*': (l,r)=>l*r,
    '/': (l,r)=>l/r,
    '%': (l,r)=>l%r,
    '^': (l,r)=>(Math.pow(l,r) || 0),
  }
  let precedence = {'^':1,'%':2,'/':2,'*':2,'-':3,'+':3,}

  let precedenceTree = (ops) => {
    // Build an operator tree back up from a flattened list, taking precedence into account
    if (ops.length < 3) { return ops[0] }
    let pivot = -1
    let p = 0
    for (let i=1; i < ops.length; i+=2) {
      let opP = precedence[ops[i]]
      if (opP && opP > p) {
        p = opP
        pivot = i
      }
    }
    if (pivot < 0) { return ops[0] }
    let lhs = precedenceTree(ops.slice(0, pivot))
    let rhs = precedenceTree(ops.slice(pivot+1))
    return evalOperator(operators[ops[pivot]], lhs, rhs)
  }

  return precedenceTree
})