'use strict';
define(function(require) {

  let digitChar = (char) => (char >= '0' && char <= '9') || char == '.'
  let numberChar = (char) => digitChar(char) || char == 'e'
  let firstChar = (char) => digitChar(char) || char == '-' || char == '+'

  let numberValue = (state) => {
    if (!firstChar(state.str.charAt(state.idx))) { return undefined }
    let value = ''
    let char
    let sign = true
    while (char = state.str.charAt(state.idx)) {
      if (char == '') { break }
      if (sign && (char == '-' || char == '+') && numberChar(state.str.charAt(state.idx+1))) {
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
    let v = numerator/denominator
    if (
      (state.str.charAt(state.idx) === 'd' || state.str.charAt(state.idx) === 'D') &&
      (state.str.charAt(state.idx+1) === 'b' || state.str.charAt(state.idx+1) === 'B')
    ) {
      state.idx += 2
      v = Math.pow(10, v/20)
    }
    return v
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
  assert(1, number({str:'0db',idx:0}))
  assert(1, number({str:'0dB',idx:0}))
  assert(1, number({str:'0DB',idx:0}))
  assert(10, number({str:'20dB',idx:0}))
  assert(0.1, number({str:'-20dB',idx:0}))
  assert(1.9952623149688795, number({str:'6dB',idx:0}))
  assert(1.9952623149688795, number({str:'+6dB',idx:0}))
  assert(undefined, number({str:'a',idx:0}))
  assert(undefined, number({str:'-',idx:0}))
  assert(undefined, number({str:'-a',idx:0}))
  assert(undefined, number({str:'e',idx:0}))
  assert(undefined, number({str:'efoo',idx:0}))
  
  console.log('Parse number tests complete')
  }
  
  return number
})