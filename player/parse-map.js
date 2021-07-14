'use strict';
define(function(require) {
  let eatWhitespace = require('player/eat-whitespace')
  let hoistTuples = require('player/hoist-tuples').hoistTuples

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
  let parseMapEntry = (state, keys, values) => {
    eatWhitespace(state)
    let k = identifier(state)
    if (k === '') { return }
    eatWhitespace(state)
    if (state.str.charAt(state.idx) !== ':') { return }
    state.idx += 1
    eatWhitespace(state)
    let v = state.expression(state)
    eatWhitespace(state)
    keys.push(k)
    values.push(v)
  }

  let buildMap = (vs, keys) => {
    let result = {}
    for (let i=0; i<vs.length; i++) {
      result[keys[i]] = vs[i]
    }
    return result
  }

  let parseMap = (state) => {
    let keys = []
    let values = []
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') { state.idx += 1; continue }
      if (char == '{' || char == ',') {
        state.idx += 1
        parseMapEntry(state, keys, values)
      } else if (char == '}') {
        state.idx += 1
        break
      } else {
        return undefined
      }
    }
    return hoistTuples(buildMap)(values, keys)
  }

  return parseMap
})