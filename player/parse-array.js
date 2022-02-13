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

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    let number = require('player/parse-number') // Expressions should only be numbers in these tests for simplicity
  
    assert([], array({str:'',idx:0,expression:number}, '[', ']'))
    assert([], array({str:'[]',idx:0,expression:number}, '[', ']'))
    assert([], array({str:'[',idx:0,expression:number}, '[', ']'))
    assert([], array({str:'a',idx:0,expression:number}, '[', ']'))
    assert([1], array({str:'[1]',idx:0,expression:number}, '[', ']'))
    assert([1,2,3], array({str:'[1,2,3]',idx:0,expression:number}, '[', ']'))
    assert([1,2,3], array({str:'[1:2:3]',idx:0,expression:number}, '[', ']'))
    assert(',', array({str:'[1,2]',idx:0,expression:number}, '[', ']').separator)
    assert(':', array({str:'[1:2]',idx:0,expression:number}, '[', ']').separator)
    assert([], array({str:'[1,2:3]',idx:0,expression:number}, '[', ']'))
    assert([1,2,3], array({str:'[1:2:3]',idx:0,expression:number}, '[', ']'))
    assert([1,2,3], array({str:'(1,2,3)',idx:0,expression:number}, '(', ')'))
    assert([], array({str:'[1,2,3]',idx:0,expression:number}, '(', ')'))
    assert([1,2,3], array({str:'[1,2,3',idx:0,expression:number}, '[', ']'))
    assert([1,2,3], array({str:'[1,2,3,]',idx:0,expression:number}, '[', ']'))
    
    console.log('Parse array tests complete')
    }
      
    return array
})