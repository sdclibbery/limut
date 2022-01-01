'use strict';
define(function(require) {
  let {evalParamFrame} = require('player/eval-param')

  let elementByIndex = (tuple, idx, e,b) => {
    if (typeof(idx) === 'function' && idx.isTupleAggregator) {
      return idx(tuple, e,b)
    }
    return tuple[Math.floor(evalParamFrame(idx, e,b)) % tuple.length]
  }

  let select = (v, indices, event, b) => {
    if (!!indices && indices.length > 0) {
      if (indices.separator === ':') {
        let vn = []
        let loIdx = Math.floor(evalParamFrame(indices[0], event,b))
        let hiIdx = Math.floor(evalParamFrame(indices[1], event,b))
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

  return select
})