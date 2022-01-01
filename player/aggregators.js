'use strict'
define(function(require) {
  let vars = require('vars')
  let {evalParamFrame} = require('player/eval-param')

  let createAggregator = (name, fn) => {
    let aggFunc = (args, e,b,evalRecurse) => {
      let vs
      if (!args) { vs = [0] }
      else if (Array.isArray(args)) { vs = args }
      else if (Array.isArray(args.value)) { vs = args.value }
      else if (args.value !== undefined) { vs = [args.value] }
      else { vs = [0] }
      vs = evalParamFrame(vs, e,b)
      return fn(vs)
    }
    aggFunc.isVarFunction = true
    vars[name] = aggFunc
  }

  createAggregator('first', vs => vs[0])
  createAggregator('last', vs => vs[vs.length-1])
  createAggregator('rand', vs => vs[Math.floor(Math.random()*vs.length)])

  createAggregator('max', vs => Math.max(...vs))
  createAggregator('min', vs => Math.min(...vs))

  let sum = vs => vs.reduce((a,x) => a+x, 0)
  createAggregator('count', vs => vs.length)
  createAggregator('sum', sum)
  createAggregator('avg', vs => sum(vs)/vs.length)
})
