'use strict';
define(function(require) {
  let eatWhitespace = require('player/eat-whitespace')

  let identifier = (state) => {
    let char
    let result = ''
    while (char = state.str.charAt(state.idx).toLowerCase()) {
      if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char === '_') {
        result += char
        state.idx += 1
        continue
      }
      break
    }
    return result
  }
  let parseMapEntry = (state) => {
    eatWhitespace(state)
    let k = identifier(state)
    if (k === '') { return }
    eatWhitespace(state)
    if (state.str.charAt(state.idx) !== ':') { return }
    state.idx += 1
    eatWhitespace(state)
    let v = state.expression(state)
    eatWhitespace(state)
    return {k:k,v:v}
  }
  let parseMap = (state) => {
    let result = {}
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') { state.idx += 1; continue }
      if (char == '{' || char == ',') {
        state.idx += 1
        let e = parseMapEntry(state)
        if (e) {
          result[e.k] = e.v
          if (e.v.interval && !result.interval) { result.interval = e.v.interval }
        }
      } else if (char == '}') {
        state.idx += 1
        break
      } else {
        return undefined
      }
    }
    return result
  }

  return parseMap
})