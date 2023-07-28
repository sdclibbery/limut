'use strict';
define(function(require) {
  let subsequence = require('pattern/unit/subsequence.js')
  let supersequence = require('pattern/unit/supersequence.js')
  let chord = require('pattern/unit/chord.js')

  let isDigit = (char) => char >= '0' && char <= '9'
  let isNumericFlag = (char) => char !== '-' && char !== '.' && !isDigit(char)
  let isNonNumericFlag = (char) => char === '^' // Only accent "^"" is valid for non numeric events

  let parseSteps = (state) => {
    let steps = []
    let char
    steps.numContinuations = 0
    while (char = state.str.charAt(state.idx)) {

      if (char === '' || char === ' ' || char === '\t') { break } // End of literal

      if (char === ']' || char === ')' || char === '>' || char ==='}') { // End of subpattern
        state.idx++ // Skip closing bracket after subpattern
        break
      }

      if (char === '[') { // Parse subsequence
        state.idx++ // Skip opening bracket
        let subPattern = subsequence(parseSteps(state))
        if (subPattern.scaleToFit) { subPattern.scaleToFit() } // Scale subsequence to fit inside one step of this pattern
        steps.push(subPattern)
        continue
      }

      if (char === '<') { // Parse supersequence
        state.idx++ // Skip opening bracket
        let subPattern = supersequence(parseSteps(state))
        steps.push(subPattern)
        continue
      }

      if (char === '(') { // Parse chord
        state.idx++ // Skip opening bracket
        let subPattern = chord(parseSteps(state))
        steps.push(subPattern)
        continue
      }

      if (char === '_' && steps.length > 0) { // Duration continuation; previous step takes up this step's duration too
        state.idx++
        let step = steps[steps.length-1]
        if (step.extendDur) {
          step.extendDur() // Extend previous step of this pattern by one
        } else {
          step.forEach(e => e.dur++) // Extend previous subpattern
        }
        steps.numContinuations++
        continue
      }

      let nextChar = state.str.charAt(state.idx+1)
      if (char == '-' && nextChar >= '0' && nextChar <= '9') { // Numeric values can be negative
        char = '-'+nextChar
        continue
      }

      let lastStep = steps[steps.length - 1]
      let lastEvent = lastStep && lastStep[0]
      if (isNumericFlag(char) && lastEvent && typeof lastEvent.value === 'number') { // Flag for numeric
        char = char.toLowerCase()
        if (lastEvent[char] === undefined) { lastEvent[char] = 0 }
        lastEvent[char]++
        state.idx++
        continue
      }
      if (isNonNumericFlag(char) && lastEvent && typeof lastEvent.value === 'string') { // Flag for non numeric
        if (lastEvent[char] === undefined) { lastEvent[char] = 0 }
        lastEvent[char]++
        state.idx++
        continue
      }

      let v = parseFloat(char) // Convert to number if possible
      if (isNaN(v)) { v = char }
      if (v === '.') { v = undefined}
      steps.push([{
        value: v,
        dur: 1,
      }]) // Literal event value char
      state.idx++
    }

    return steps
  }

  let literal = (state) => {
    let steps = parseSteps(state)
    return subsequence(steps) // At the top level, a literal is like a subsequence
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }

    let st = (str) => { return { str:str, idx:0 } }
    let p

    p = literal(st(''))
    assert(undefined, p.next())
    p.loop()
    assert(undefined, p.next())

    p = literal(st('[]'))
    assert(undefined, p.next())

    p = literal(st('.'))
    assert([{value:undefined,dur:1}], p.next())

    p = literal(st('x o'))
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())

    p = literal(st('x[oh]x'))
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'o',dur:1/2}], p.next())
    assert([{value:'h',dur:1/2}], p.next())
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())
  
    p = literal(st('[01][.2]'))
    assert([{value:0,dur:1/2}], p.next())
    assert([{value:1,dur:1/2}], p.next())
    assert([{value:undefined,dur:1/2}], p.next())
    assert([{value:2,dur:1/2}], p.next())
    assert(undefined, p.next())
  
    p = literal(st('x[oh]x'))
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'o',dur:1/2}], p.next())
    p.loop()
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'o',dur:1/2}], p.next())
    assert([{value:'h',dur:1/2}], p.next())
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())
  
    p = literal(st('[0[12]]'))
    assert([{value:0,dur:1/2}], p.next())
    assert([{value:1,dur:1/4}], p.next())
    assert([{value:2,dur:1/4}], p.next())
    assert(undefined, p.next())

    p = literal(st('0_'))
    assert([{value:0,dur:2}], p.next())
    assert(undefined, p.next())

    p = literal(st('_'))
    assert([{value:'_',dur:1}], p.next())
    assert(undefined, p.next())
  
    p = literal(st('x_0__'))
    assert([{value:'x',dur:2}], p.next())
    assert([{value:0,dur:3}], p.next())

    p = literal(st('[ab]_'))
    assert([{value:'a',dur:1/2}], p.next())
    assert([{value:'b',dur:3/2}], p.next())
    assert(undefined, p.next())

    p = literal(st('.[ab_c]d'))
    assert([{value:undefined,dur:1}], p.next())
    assert([{value:'a',dur:1/4}], p.next())
    assert([{value:'b',dur:1/2}], p.next())
    assert([{value:'c',dur:1/4}], p.next())
    assert([{value:'d',dur:1}], p.next())
    assert(undefined, p.next())

    p = literal(st('[[[ab]_]_]_'))
    assert([{value:'a',dur:1/8}], p.next())
    assert([{value:'b',dur:15/8}], p.next())
    assert(undefined, p.next())

    p = literal(st('[[[ab]]]_'))
    assert([{value:'a',dur:1/2}], p.next())
    assert([{value:'b',dur:3/2}], p.next())
    assert(undefined, p.next())

    p = literal(st('[[a[bc]]]_'))
    assert([{value:'a',dur:1/2}], p.next())
    assert([{value:'b',dur:1/4}], p.next())
    assert([{value:'c',dur:5/4}], p.next())
    assert(undefined, p.next())

    p = literal(st('a[b_[c_d]_]_e'))
    assert([{value:'a',dur:1}], p.next())
    assert([{value:'b',dur:2/4}], p.next())
    assert([{value:'c',dur:2/12}], p.next())
    assert([{value:'d',dur:16/12}], p.next())
    assert([{value:'e',dur:1}], p.next())
    assert(undefined, p.next())

    p = literal(st('[aa_[b_[c_d]_]_]_'))
    assert([{value:'a',dur:1/5}], p.next())
    assert([{value:'a',dur:2/5}], p.next())
    assert([{value:'b',dur:2/20}], p.next())
    assert([{value:'c',dur:2/60}], p.next())
    assert([{value:'d',dur:76/60}], p.next())
    assert(undefined, p.next())

    p = literal(st('0<12>'))
    p.reset(0)
    assert([{value:0,dur:1}], p.next())
    assert([{value:1,dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:0,dur:1}], p.next())
    assert([{value:2,dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:0,dur:1}], p.next())
    assert([{value:1,dur:1}], p.next())
    assert(undefined, p.next())
    p.reset(0) // Reset back to beginning; get a 1 again
    assert([{value:0,dur:1}], p.next())
    assert([{value:1,dur:1}], p.next())
    assert(undefined, p.next())

    p = literal(st('0<1[23]>'))
    assert([{value:0,dur:1}], p.next())
    assert([{value:1,dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:0,dur:1}], p.next())
    assert([{value:2,dur:1/2}], p.next())
    assert([{value:3,dur:1/2}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:0,dur:1}], p.next())
    assert([{value:1,dur:1}], p.next())
    assert(undefined, p.next())

    p = literal(st('0<1<23>>'))
    assert([{value:0,dur:1}], p.next())
    assert([{value:1,dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:0,dur:1}], p.next())
    assert([{value:2,dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:0,dur:1}], p.next())
    assert([{value:1,dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:0,dur:1}], p.next())
    assert([{value:3,dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:0,dur:1}], p.next())
    assert([{value:1,dur:1}], p.next())
    assert(undefined, p.next())

    p = literal(st('0<12>'))
    p.reset(1) // Reset to one repeat; should give a 2 on the first repeat now
    assert([{value:0,dur:1}], p.next())
    assert([{value:2,dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:0,dur:1}], p.next())
    assert([{value:1,dur:1}], p.next())
    assert(undefined, p.next())

    p = literal(st('<12>_'))
    p.reset(0)
    assert([{value:1,dur:2}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:2,dur:2}], p.next())
    assert(undefined, p.next())

    p = literal(st('(01)'))
    p.reset(0)
    assert([{value:0,dur:1},{value:1,dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:0,dur:1},{value:1,dur:1}], p.next())
    assert(undefined, p.next())

    p = literal(st('(01)_'))
    assert([{value:0,dur:2},{value:1,dur:2}], p.next())
    assert(undefined, p.next())

    p = literal(st('(0[12])'))
    assert([{value:0,dur:1},{value:1,dur:1/2}], p.next())
    assert([{value:2,dur:1/2}], p.next())
    assert(undefined, p.next())

    p = literal(st('(0[12])_'))
    assert([{value:0,dur:2},{value:1,dur:1/2}], p.next())
    assert([{value:2,dur:3/2}], p.next())
    assert(undefined, p.next())

    p = literal(st('(0<12>)'))
    p.reset(0)
    assert([{value:0,dur:1},{value:1,dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:0,dur:1},{value:2,dur:1}], p.next())
    assert(undefined, p.next())

    p = literal(st('0<1(23)>'))
    p.reset(0)
    assert([{value:0,dur:1}], p.next())
    assert([{value:1,dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:0,dur:1}], p.next())
    assert([{value:2,dur:1},{value:3,dur:1}], p.next())
    assert(undefined, p.next())

    p = literal(st('0[1(23)]'))
    p.reset(0)
    assert([{value:0,dur:1}], p.next())
    assert([{value:1,dur:1/2}], p.next())
    assert([{value:2,dur:1/2},{value:3,dur:1/2}], p.next())
    assert(undefined, p.next())

    assert([{value:0,dur:1,'#':1}], literal(st('0#')).next())
    assert([{value:1,dur:1,'#':2}], literal(st('1##')).next())
    assert([{value:2,dur:1,'a':1}], literal(st('2a')).next())
    assert([{value:3,dur:1,'a':2}], literal(st('3Aa')).next())
    assert([{value:4,dur:1,'a':1,'#':1,'b':1,'!':1,'=':1,'^':1,'v':1}], literal(st('4a#b!=^v')).next())
    assert([{value:'x',dur:1}], literal(st('x#')).next())
    assert([{value:'x',dur:1,'^':1}], literal(st('x^')).next())

    // p = literal(st('([01][234])'))
    // assert([{value:0,dur:1/2},{value:2,dur:1/3}], p.next())
    // assert([{value:3,dur:1/3}], p.next())
    // assert([{value:1,dur:1/2}], p.next())
    // assert([{value:4,dur:1/3}], p.next())
    // assert(undefined, p.next())

    console.log("Pattern unit literal tests complete")
  }
  
  return literal
});
