'use strict'
define(function(require) {
  let addVarFunction = require('predefined-vars').addVarFunction

  let getArrayFromValues = (args) => {
    let result = [args.value]
    let index = 1
    let v
    do {
      let key = 'value'+index
      index++
      v = args[key]
      if (v) { result.push(v) }
    } while (v)
    return result
  }
  
  let createAggregator = (name, fn) => {
    let aggFunc = (args, e,b) => {
      let vs
      if (!args) { vs = [] }
      else if (Array.isArray(args)) { vs = args }
      else if (Array.isArray(args.value)) { vs = args.value }
      else if (args.value !== undefined) { vs = getArrayFromValues(args) }
      else if (typeof args === 'number') { vs = [args] }
      else { vs = [] }
      vs = vs.flatMap(v => {
        if (typeof(v) === 'object' && v.hasOwnProperty('value')) { return v.value }
        return v
      }).map(v => v===undefined?0:v)
      return {value:fn(vs),_finalResult:true} // This is the final result if used in lookup op; do not do a further lookup
    }
    aggFunc._isAggregator = true
    aggFunc._requiresValue = true
    addVarFunction(name, aggFunc)
    return aggFunc
  }

  let wrapper = (fn) => {
    return (vs) => {
      if (vs.length === 0) { return 0 }
      if (vs.length === 1) { return vs[0] }
      return fn(vs)
    }
  }
  let sum = vs => vs.reduce((a,x) => a+x, 0)
  let aggregators = {
    'max': createAggregator('max', wrapper(vs => Math.max(...vs))),
    'min': createAggregator('min', wrapper(vs => Math.min(...vs)||0)),
    'first': createAggregator('first', wrapper(vs => vs[0])),
    'last': createAggregator('last', wrapper(vs => vs[vs.length-1])),
    'avg': createAggregator('avg', wrapper(vs => sum(vs)/vs.length)),
    'sum': createAggregator('sum', wrapper(vs => sum(vs))),
    'count': createAggregator('count', vs => vs.length),
  }

  let getAggregator = (name) => {
    return aggregators[name]
  }

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  
    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }

    assert(0, getAggregator('count')([]).value)
    assert(0, getAggregator('count')().value)
    assert(3, getAggregator('count')([1,1,1]).value)
    assert(3, getAggregator('count')({value:[1,1,1]}).value)
    assert(3, getAggregator('count')({value:1,value1:1,value2:1}).value)
    assert(3, getAggregator('count')([1,1,1]).value)
    assert(3, getAggregator('count')([{value:[1,1,1]}]).value)
    assert(3, getAggregator('count')([{value:1},{value:1},{value:1}]).value)

    assert(6, getAggregator('sum')([1,2,3]).value)
    assert(1, getAggregator('first')([1,2,3]).value)
    assert(3, getAggregator('last')([1,2,3]).value)
    assert(2, getAggregator('avg')([1,2,3]).value)

    assert(0, getAggregator('min')([]).value)
    assert(0, getAggregator('max')([]).value)
    assert(2, getAggregator('max')(2).value)
    assert(0, getAggregator('first')([]).value)
    assert(0, getAggregator('last')([]).value)
    assert(0, getAggregator('count')([]).value)
    assert(0, getAggregator('sum')([]).value)
    assert(0, getAggregator('avg')([]).value)

    console.log('Aggregator tests complete')
  }
})
