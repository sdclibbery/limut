'use strict';
define(function(require) {

  let hoistTuples = (operation) => (vs, p1,p2,p3,p4) => {
    let maxLength = vs.filter(Array.isArray).reduce((a,b) => Math.max(a,b.length), 0)
    if (maxLength <= 1) { return operation(vs, p1,p2,p3,p4) }
    return Array.from({length: maxLength}).map((_,i) => {
      let vst = vs.map(v => (Array.isArray(v)) ? v[i%v.length] : v)
      return operation(vst, p1,p2,p3,p4)
    })
  }

  return {
    hoistTuples: hoistTuples,
  }
})