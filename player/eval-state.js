'use strict';
define((require) => {

  let state = {}

  let push = (k,v) => {
    let oldV = state[k]
    state[k] = v
    return oldV
  }

  let pop = (k,oldV) => {
    state[k] = oldV
  }

  let withEvalState = (k, v, action) => {
    let old = push(k,v)
    let result = action()
    pop(k,old)
    return result
  }

  let getEvalState = (k) => state[k]

  return {
    withEvalState: withEvalState,
    getEvalState: getEvalState
  }

})
