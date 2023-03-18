'use strict';
define(function(require) {

  let digitChar = (char) => (char >= '0' && char <= '9') || char == '.'
  let numberChar = (char) => digitChar(char) || char == 'e'
  let firstChar = (char) => digitChar(char) || char == '-'

  let numberValue = (state) => {
    if (!firstChar(state.str.charAt(state.idx))) { return undefined }
    let value = ''
    let char
    let sign = true
    while (char = state.str.charAt(state.idx)) {
      if (char == '') { break }
      if (sign && char == '-' && numberChar(state.str.charAt(state.idx+1))) {
        sign = false
        value += char
        state.idx += 1
        continue
      }
      if (numberChar(char)) {
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
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  assert(1, number({str:'1',idx:0}))
  assert(1e9, number({str:'1e9',idx:0}))
  assert(-2, number({str:'-2',idx:0}))
  assert(undefined, number({str:'a',idx:0}))
  assert(undefined, number({str:'-',idx:0}))
  assert(undefined, number({str:'-a',idx:0}))
  assert(undefined, number({str:'e',idx:0}))
  assert(undefined, number({str:'efoo',idx:0}))
  
  console.log('Parse number tests complete')
  }
  
  return number
})