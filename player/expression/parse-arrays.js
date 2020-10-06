'use strict';
define(function(require) {
  let number = require('player/parse-number')

  let doArray = (state, open, close, seperator, expression) => {
    let result = []
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char == open) {
        state.idx += 1
        let v = expression(state)
        if (v !== undefined) { result.push(v) }
      } else if (char == seperator) {
        state.idx += 1
        let v = expression(state)
        if (v !== undefined) { result.push(v) }
      } else if (char == close) {
        state.idx += 1
        break
      } else {
        return undefined
      }
    }
    return result
  }

  let array = (state, open, close, expressionParser) => {
    let tryState = Object.assign({}, state)
    let commaArray = doArray(tryState, open, close, ',', expressionParser)
    if (commaArray != undefined) {
      Object.assign(state, tryState)
      commaArray.seperator = ','
      return commaArray
    }
    let colonArray = doArray(state, open, close, ':', expressionParser)
    if (colonArray == undefined) { return [] }
    colonArray.seperator = ':'
    return colonArray
  }

  let expandColon = (vs) => {
    if (vs.seperator == ':') {
      let lo = 0
      let hi = 1
      if (vs.length == 1) {
        hi = vs[0]
      } else if (vs.length == 2) {
        lo = vs[0]
        hi = vs[1]
      }
      if (Number.isInteger(lo) && Number.isInteger(hi)) {
        return [...Array(hi-lo+1).keys()].map(x => x+lo)
      }
    }
    return vs
  }

  let numberOrArrayOrFour = (state, expressionParser) => {
    let n = number(state)
    if (n !== undefined) {
      return n
    } else {
      if (state.str.charAt(state.idx) == '[') {
        let ds = array(state, '[', ']', expressionParser)
        return ds
      } else {
        return 4
      }
    }
  }

  return {
    array: array,
    expandColon: expandColon,
    numberOrArrayOrFour: numberOrArrayOrFour,
  }
})