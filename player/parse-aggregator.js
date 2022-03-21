'use strict'
define(function(require) {
  let parseMap = require('player/parse-map')
  let wrapMods = require('player/time-modifiers').wrapMods
  let {evalParamFrame} = require('player/eval-param')
  let {isVarChar} = require('player/parse-var')

  let createAggregator = (name, fn) => {
    let aggFunc = (args, e,b,evalRecurse) => {
      let vs
      if (!args) { vs = [] }
      else if (Array.isArray(args)) { vs = args }
      else if (Array.isArray(args.value)) { vs = args.value }
      else if (args.value !== undefined) { vs = [args.value] }
      else { vs = [] }
      vs = vs.flatMap(v => {
        if (typeof(v) === 'object' && v.hasOwnProperty('value')) { return v.value }
        return v
      }).map(v => v===undefined?0:v)
      return fn(vs)
    }
    aggFunc.isVarFunction = true
    aggFunc.isTupleAggregator = true
    aggFunc.evalOverride = name // If this ever gets evaluated as a value rather than an aggregator, then return the original name as a string. This allows `blend=min` to work alongside the 'min' aggregator.
    return aggFunc
  }

  let tryParseAggregator = (state, name, fn) => {
    if (state.str.slice(state.idx,state.idx+name.length).toLowerCase() === name) {
      if (isVarChar(state.str[state.idx+name.length])) { return } // If this isn't the end of the identifier, it can't be a match
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
    let result = tryParseAggregator(state, 'max', vs => vs.length===0?0:Math.max(...vs))
        || tryParseAggregator(state, 'min', vs => vs.length===0?0:Math.min(...vs)||0)
        || tryParseAggregator(state, 'first', vs => vs.length===0?0:vs[0])
        || tryParseAggregator(state, 'last', vs => vs.length===0?0:vs[vs.length-1])
        || tryParseAggregator(state, 'rand', vs => vs.length===0?0:vs[Math.floor(Math.random()*vs.length)])
        || tryParseAggregator(state, 'count', vs => vs.length)
        || tryParseAggregator(state, 'sum', sum)
        || tryParseAggregator(state, 'avg', vs => vs.length===0?0:sum(vs)/vs.length)
    return result
  }

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  
    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    let st = (str) =>  { return {str:str,idx:0,parseInterval:()=>'',hoistInterval:()=>'',setInterval:()=>''} }

    assert(0, parseAggregator(st('count'))([]))
    assert(0, parseAggregator(st('count'))())
    assert(3, parseAggregator(st('count'))([1,1,1]))
    assert(3, parseAggregator(st('count'))({value:[1,1,1]}))
    assert(3, parseAggregator(st('count'))([1,1,1]))
    assert(3, parseAggregator(st('count'))([{value:[1,1,1]}]))
    assert(3, parseAggregator(st('count'))([{value:1},{value:1},{value:1}]))

    assert(6, parseAggregator(st('sum'))([1,2,3]))
    assert(1, parseAggregator(st('first'))([1,2,3]))
    assert(3, parseAggregator(st('last'))([1,2,3]))
    assert(2, parseAggregator(st('avg'))([1,2,3]))

    assert(0, parseAggregator(st('min'))([]))
    assert(0, parseAggregator(st('max'))([]))
    assert(0, parseAggregator(st('first'))([]))
    assert(0, parseAggregator(st('last'))([]))
    assert(0, parseAggregator(st('rand'))([]))
    assert(0, parseAggregator(st('count'))([]))
    assert(0, parseAggregator(st('sum'))([]))
    assert(0, parseAggregator(st('avg'))([]))

    assert('function', typeof parseAggregator(st('count')))
    assert('undefined', typeof parseAggregator(st('countdown')))

    console.log('Parse aggregator tests complete')
  }
  
  return parseAggregator
})
