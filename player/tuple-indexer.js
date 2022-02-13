'use strict';
define(function(require) {
  let {evalParamFrame} = require('player/eval-param')
  let param = require('player/default-param')

  let elementByIndex = (tuple, idx, e,b) => {
    if (typeof(idx) === 'function' && idx.isTupleAggregator) {
      return idx(tuple, e,b)
    }
    return tuple[Math.floor(evalParamFrame(idx, e,b)) % tuple.length]
  }

  let select = (v, indices, event, b) => {
    if (!!indices && indices.length > 0 && Array.isArray(v)) {
      if (indices.separator === ':') {
        let vn = []
        let i = Math.floor(evalParamFrame(param(indices[0], 0), event,b))
        let j = Math.floor(evalParamFrame(param(indices[1], 0), event,b))
        let loIdx = Math.min(i,j)
        let hiIdx = Math.max(i,j)
        for (let idx = loIdx; idx <= hiIdx; idx++) {
          vn.push(v[idx % v.length])
        }
        v = vn
      } else {
        v = indices.map(idx => {
          return elementByIndex(v, idx, event,b)
        })
      }
    }
    if (!!v && v.length === 1) { v = v[0] }
    if (!!v && v.length === 0) { v = 0 }
    return v
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    let range = (a,b) => {
      let r = [a,b]
      r.separator = ':'
      return r
    }

    assert(0, select([], []))
    assert(undefined, select([], [0]))
    assert(1, select([1], []))
    assert(1, select([1], [0]))
    assert(1, select([1,2], [0]))
    assert(2, select([1,2], [1]))
    assert(1, select([1,2], [2]))
    assert(2, select([1,2], [3]))
    assert([1,2], select([1,2,3,4], [0,1]))
    assert(1, select(1, []))
    assert(1, select(1, [0]))
    assert(1, select(1, [0,1])) // Wrong really, should return `[1,1]`

    assert([2,3], select([1,2,3,4], range(1,2)))
    assert([1,2,3,4], select([1,2,3,4], range(0,3)))
    assert([1,2,3,4,1,2,3,4], select([1,2,3,4], range(0,7)))
    assert([2,3], select([1,2,3,4], range(2,1)))
    assert(2, select([1,2,3,4], range(1,1)))
    assert([1,2,3], select([1,2,3,4], range(2)))

    console.log('Tuple indexer tests complete')
  }

  return select
})