'use strict';
define(function(require) {
  let {evalParamFrame} = require('player/eval-param')
  let param = require('player/default-param')

  let byIndex = (v, idx) => {
    let r = v[idx]
    if (r === undefined && typeof v.length === 'number') { r = v[Math.floor(idx) % v.length] }
    return r
  }

  let elementByIndex = (v, idx, e,b) => {
    if (typeof(idx) === 'function' && idx.isTupleAggregator) {
      return idx(v, e,b)
    }
    return byIndex(v, evalParamFrame(idx, e,b))
  }

  let select = (v, indices, event, b) => {
    let isArray = Array.isArray(v)
    let isObject = !isArray && typeof v === 'object'
    if (!!indices && indices.length > 0 && (isArray || isObject)) {
      if (indices.separator === ':') {
        let vn = []
        let i = Math.floor(evalParamFrame(param(indices[0], 0), event,b))
        let j = Math.floor(evalParamFrame(param(indices[1], 0), event,b))
        let loIdx = Math.min(i,j)
        let hiIdx = Math.max(i,j)
        for (let idx = loIdx; idx <= hiIdx; idx++) {
          vn.push(byIndex(v, idx))
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

    assert([1,2], select([[1,2],[3,4]], [0]))
    assert([3,4], select([[1,2],[3,4]], [1]))

    assert([2,3], select([1,2,3,4], range(1,2)))
    assert([1,2,3,4], select([1,2,3,4], range(0,3)))
    assert([1,2,3,4,1,2,3,4], select([1,2,3,4], range(0,7)))
    assert([2,3], select([1,2,3,4], range(2,1)))
    assert(2, select([1,2,3,4], range(1,1)))
    assert([1,2,3], select([1,2,3,4], range(2)))

    assert(2, select({foo:2}, ['foo']))
    assert([2,3], select({foo:2,bar:3}, ['foo','bar']))
    let vs = {}
    vs[0] = 1
    vs[1] = 2
    assert([2,1], select(vs, [1,0]))
   
    console.log('Tuple indexer tests complete')
  }

  return select
})