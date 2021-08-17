'use strict';
define(function(require) {

  let hoistTuples = (operation) => (vs, p1,p2,p3,p4) => {
    let fn = operation(vs, p1,p2,p3,p4)
    let cardinality = vs.reduce((a,v) => Math.max(a, Array.isArray(v) ? v.length : 0), 0)
    if (cardinality == 0) { return fn }
    return (e,b,evalRecurse) => {
      let r = fn(e,b,evalRecurse)
      if (!Array.isArray(r)) { r = [r] }
      let origLen = r.length
      for (let i=0; i<cardinality; i++) {
        if (i > (r.length-1)) { r[i] = r[i%origLen] }
      }
      return r
    }
  }

  return {
    hoistTuples: hoistTuples,
  }
})