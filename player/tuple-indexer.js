'use strict';
define(function(require) {
  let {evalParamFrame} = require('player/eval-param')

  let select = (v, indices, event, b) => {
    if (!!indices && indices.length > 0) {
      if (indices.separator === ':') {
        let vn = []
        let lo = Math.floor(evalParamFrame(indices[0], event,b))
        let hi = Math.floor(evalParamFrame(indices[1], event,b))
        for (let idx = lo; idx <= hi; idx++) {
          vn.push(v[idx % v.length])
        }
        v = vn
      } else {
        v = indices.map(idx => {
          let evalled = evalParamFrame(idx, event,b)
          return v[Math.floor(evalled) % v.length]
        })
      }
    }
    if (!!v && v.length === 1) { v = v[0] }
    if (!!v && v.length === 0) { v = 0 }
    return v
  }

  return select
})