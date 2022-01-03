'use strict'
define(function(require) {
  let parseMap = require('player/parse-map')
  let wrapMods = require('player/time-modifiers').wrapMods
  let {evalParamFrame} = require('player/eval-param')

  let createAggregator = (name, fn) => {
    let aggFunc = (args, e,b,evalRecurse) => {
      let vs
      if (!args) { vs = [0] }
      else if (Array.isArray(args)) { vs = args }
      else if (Array.isArray(args.value)) { vs = args.value }
      else if (args.value !== undefined) { vs = [args.value] }
      else { vs = [0] }
      vs = vs.map(v => {
        if (typeof(v) === 'object' && v.hasOwnProperty('value')) { return v.value }
        return v
      }).map(v => v===undefined?0:v)
      if (vs.length === 0) { vs = [0] }
      return fn(vs)
    }
    aggFunc.isVarFunction = true
    aggFunc.isTupleAggregator = true
    return aggFunc
  }

  let tryParseAggregator = (state, name, fn) => {
    if (state.str.slice(state.idx,state.idx+name.length).toLowerCase() === name) {
      state.idx += name.length
      let aggFn = createAggregator(name, fn)
      let args = parseMap(state)
      let result
      if (!!args) { // call aggregator as function
        result = (e,b,evalRecurse) => aggFn(evalParamFrame(args,e,b), e,b,evalRecurse)
      } else { // return aggregator function directly for use as a tuple indexer
        result = aggFn          
      }
      let modifiers = parseMap(state)
      result = wrapMods(result, modifiers)
      let interval = state.parseInterval(state)
      if (typeof result === 'function') {
        state.setInterval(result, interval || state.hoistInterval('event', args))
      }
      return result
    }
  }

  let sum = vs => vs.reduce((a,x) => a+x, 0)
  let parseAggregator = (state) => {
    let result = tryParseAggregator(state, 'max', vs => Math.max(...vs))
        || tryParseAggregator(state, 'min', vs => Math.min(...vs))
        || tryParseAggregator(state, 'first', vs => vs[0])
        || tryParseAggregator(state, 'last', vs => vs[vs.length-1])
        || tryParseAggregator(state, 'rand', vs => vs[Math.floor(Math.random()*vs.length)])
        || tryParseAggregator(state, 'count', vs => vs.length)
        || tryParseAggregator(state, 'sum', sum)
        || tryParseAggregator(state, 'avg', vs => sum(vs)/vs.length)
    return result
  }

  return parseAggregator
})
