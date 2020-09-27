'use strict';
define(function(require) {

  let numberValue = (state) => {
    let value = ''
    let char
    let sign = true
    while (char = state.str.charAt(state.idx)) {
      if (char == '') { break }
      if (sign && char == '-') {
        sign = false
        value += char
        state.idx += 1
        continue
      }
      if ((char >= '0' && char <= '9') || char == '.' || char == 'e') {
        sign = false
        value += char
        state.idx += 1
        continue
      }
      break
    }
    if (value == '') { return undefined }
    return parseFloat(value)
  }
  let number = (state) => {
    let numerator = numberValue(state)
    if (numerator === undefined) { return undefined }
    let denominator = 1
    if (state.str.charAt(state.idx) == '/') {
      state.idx += 1
      denominator = numberValue(state)
      if (denominator === undefined) {
        state.idx -= 1
        denominator = 1
      }
    }
    // console.log('number', numerator/denominator, state)
    return numerator/denominator
  }

  return number
})