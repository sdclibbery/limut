'use strict';
define(function (require) {

  let createNonChordExpandedParam = (params, p, idx, v) => {
    let id = '_'+p+idx
    params[id] = v
    return id
  }

  let expandNonChordParam = (params, p) => {
    let v = params[p]
    if (!Array.isArray(v)) {
      return [createNonChordExpandedParam(params, p, 0, v)]
    }
    return v.map((v, idx) => createNonChordExpandedParam(params, p, idx, v))
  }

  return {
    expandNonChordParam: expandNonChordParam,
  }
});
