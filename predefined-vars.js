'use strict'
define(function(require) {
  let predefinedVars = {}

  let add = (k, v) => { predefinedVars[k] = v }

  let addVarFunction = (k, v) => {
    v.isVarFunction = true
    add(k, v)
  }

  let getVarFunction = (k) => {
    let r = predefinedVars[k]
    if (typeof r === 'function' && r.isVarFunction) { return r }
    return undefined
  }

  let apply = (vars) => {
    Object.assign(vars, predefinedVars)
  }

  return {
    add: add,
    addVarFunction: addVarFunction,
    getVarFunction: getVarFunction,
    apply: apply,
  }
})
