'use strict'
define(function(require) {
  let createAggregator = (name, fn) => {
    let aggFunc = (args, e,b) => {
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
    return aggFunc
  }

  let sum = vs => vs.reduce((a,x) => a+x, 0)
  let aggregators = {
    'max': createAggregator('max', vs => vs.length===0?0:Math.max(...vs)),
    'min': createAggregator('min', vs => vs.length===0?0:Math.min(...vs)||0),
    'first': createAggregator('first', vs => vs.length===0?0:vs[0]),
    'last': createAggregator('last', vs => vs.length===0?0:vs[vs.length-1]),
    'rand': createAggregator('rand', vs => vs.length===0?0:vs[Math.floor(Math.random()*vs.length)]),
    'count': createAggregator('count', vs => vs.length),
    'sum': createAggregator('sum', sum),
    'avg': createAggregator('avg', vs => vs.length===0?0:sum(vs)/vs.length),
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

    assert(0, getAggregator('count')([]))
    assert(0, getAggregator('count')())
    assert(3, getAggregator('count')([1,1,1]))
    assert(3, getAggregator('count')({value:[1,1,1]}))
    assert(3, getAggregator('count')([1,1,1]))
    assert(3, getAggregator('count')([{value:[1,1,1]}]))
    assert(3, getAggregator('count')([{value:1},{value:1},{value:1}]))

    assert(6, getAggregator('sum')([1,2,3]))
    assert(1, getAggregator('first')([1,2,3]))
    assert(3, getAggregator('last')([1,2,3]))
    assert(2, getAggregator('avg')([1,2,3]))

    assert(0, getAggregator('min')([]))
    assert(0, getAggregator('max')([]))
    assert(0, getAggregator('first')([]))
    assert(0, getAggregator('last')([]))
    assert(0, getAggregator('rand')([]))
    assert(0, getAggregator('count')([]))
    assert(0, getAggregator('sum')([]))
    assert(0, getAggregator('avg')([]))

    assert('function', typeof getAggregator('count'))
    assert('undefined', typeof getAggregator('countdown'))

    console.log('Aggregator tests complete')
  }
  
  return getAggregator
})
