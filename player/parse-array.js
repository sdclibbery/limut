'use strict';
define(function(require) {
  let eatWhitespace = require('player/eat-whitespace')

  let doArray = (state, open, close, separator) => {
    let result = []
    let char
    if (state.str.charAt(state.idx) !== open) {
      return undefined
    }
    while (char = state.str.charAt(state.idx)) {
      if (char == open) {
        state.idx += 1
        let v = state.expression(state)
        if (v !== undefined) { result.push(v) }
      } else if (char == separator) {
        state.idx += 1
        let v = state.expression(state)
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

  let array = (state, open, close) => {
    let tryState = Object.assign({}, state)
    let commaArray = doArray(tryState, open, close, ',')
    if (commaArray != undefined) {
      Object.assign(state, tryState)
      commaArray.separator = ','
      return commaArray
    }
    let colonArray = doArray(state, open, close, ':')
    if (colonArray == undefined) { return [] }
    colonArray.separator = ':'
    return colonArray
  }

  return array
})