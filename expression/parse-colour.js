'use strict';
define(function(require) {

  let parseColour = (state) => {
    let str = ''
    let char
    while (char = state.str.charAt(state.idx).toLowerCase()) {
      if ((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
        str += char
        state.idx += 1
        continue
      }
      break
    }
    let result = {}
    if (str.length == 3) {
      let hex1 = (c) => parseInt(c,16)*0x11/255
      result.r = hex1(str.substr(0,1))
      result.g = hex1(str.substr(1,1))
      result.b = hex1(str.substr(2,1))
      result.a = 1
    } else if (str.length == 6) {
      let hex2 = (c) => parseInt(c,16)/255
      result.r = hex2(str.substr(0,2))
      result.g = hex2(str.substr(2,2))
      result.b = hex2(str.substr(4,2))
      result.a = 1
    } else if (str.length == 4) {
      let hex1 = (c) => parseInt(c,16)*0x11/255
      result.r = hex1(str.substr(0,1))
      result.g = hex1(str.substr(1,1))
      result.b = hex1(str.substr(2,1))
      result.a = hex1(str.substr(3,1))
    } else if (str.length == 8) {
      let hex2 = (c) => parseInt(c,16)/255
      result.r = hex2(str.substr(0,2))
      result.g = hex2(str.substr(2,2))
      result.b = hex2(str.substr(4,2))
      result.a = hex2(str.substr(6,2))
    }
    return result
  }

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    let state = (txt) => {return {str:txt,idx:0}}

    assert({r:0,g:0.2,b:0.4,a:1}, parseColour(state("036f")))
    assert({r:0,g:0.2,b:0.4,a:1}, parseColour(state("003366ff")))
    assert({r:0,g:0.2,b:0.4,a:0.6}, parseColour(state("0369")))
    assert({r:0,g:0.2,b:0.4,a:0.6}, parseColour(state("00336699")))
    assert({r:0,g:0.2,b:0.4,a:1}, parseColour(state("036")))
    assert({r:0,g:0.2,b:0.4,a:1}, parseColour(state("003366")))
      
    console.log('Parse colour tests complete')
  }

  return parseColour
})