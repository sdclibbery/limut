'use strict';
define(function(require) {
  let {intervalLte} = require('player/expression/eval-intervals')

  let ops = {
    'operator+': (l,r)=>l+r,
    'operator-': (l,r)=>l-r,
    'operator*': (l,r)=>l*r,
    'operator/': (l,r)=>l/r,
    'operator%': (l,r)=>l%r,
  }
  let precedence = {'%':1,'/':1,'*':1,'-':2,'+':2,}
  let list = ['+','-','*','/','%']

  let flatten = (ops, e) => {
    // Flatten a tree of operators into a list interspersed with the operator string
    if (e.type.startsWith('operator')) {
      flatten(ops, e.lhs)
      ops.push(e.type.slice(-1))
      flatten(ops, e.rhs)
    } else {
      ops.push(e)
    }
  }

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
    return {
      type: 'operator'+ops[pivot],
      lhs:precedenceTree(ops.slice(0, pivot)),
      rhs:precedenceTree(ops.slice(pivot+1)),
    }
  }

  let evaluate = (e, evalExpression, maxInterval) => {
    let op = ops[e.type]
    if (op) {
      let lhs = evalExpression(e.lhs)
      let rhs = evalExpression(e.rhs)
      if (intervalLte(lhs.eval, maxInterval) && intervalLte(rhs.eval, maxInterval)) {
        return {value:op(lhs.value,rhs.value), eval:maxInterval, type:'number'}
      }
    }
  }

  return {
    list: list,
    precedence: precedenceTree,
    flatten: flatten,
    eval: evaluate,
  }
})