'use strict';
define(function(require) {

  let parseString = (state) => {
    let result = ''
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char == '\\') {
        state.idx += 1
        char = state.str.charAt(state.idx)
        state.idx += 1
        if (char == 'n') { result += '\n' }
        else if (char == 't') { result += '\t' }
        else if (char == 'r') { }
        else { result += char }
      }
      else if (char == '\'') {
        state.idx += 1
        break
      }
      else {
        result += char
        state.idx += 1
      }
    }
    return result
  }

  return parseString
})
