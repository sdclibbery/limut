'use strict';
define(function(require) {

  let digitChar = (char) => (char >= '0' && char <= '9') || char == '.' || char == 'e'

  let numberValue = (state) => {
    let value = ''
    let char
    let sign = true
    while (char = state.str.charAt(state.idx)) {
      if (char == '') { break }
      if (sign && char == '-' && digitChar(state.str.charAt(state.idx+1))) {
        sign = false
        value += char
        state.idx += 1
        continue
      }
      if (digitChar(char)) {
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
    return numerator/denominator
  }

  // TESTS

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  assert(1, number({str:'1',idx:0}))
  assert(-2, number({str:'-2',idx:0}))
  assert(undefined, number({str:'a',idx:0}))
  assert(undefined, number({str:'-',idx:0}))
  assert(undefined, number({str:'-a',idx:0}))
  
  console.log('Parse number tests complete')

  return number
})