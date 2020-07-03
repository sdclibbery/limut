define(function(require) {

  let vars = require('vars')

  let brackets = {
    '[': ']',
    '(': ')',
    '{': '}',
    '<': '>',
  }

  let makeTimeVar = (values, durations) => {
    if (durations === null || durations === undefined) { durations = 4 }
    if (!Array.isArray(durations)) { durations = [durations] }
    let steps = []
    let length = 0
    let step = 0
    values.forEach(v => {
      let dur = durations[step % durations.length]
      steps.push({ value:v, time:length, duration:dur })
      length += dur
      step += 1
    })
    return (time) => {
      time = time % length
      let step = steps.filter(s => (time > s.time-0.0001)&&(time < s.time+s.duration-0.0001) )[0]
      return step && step.value
    }
  }

  let parseArray = (state) => {
    let result = []
    let char
    let value = ''
    while (char = state.str.charAt(state.idx)) {
      if (brackets[char]) {
        if (state.bracketStack.length > 0) { value = value+char }
        state.bracketStack.push(brackets[char])
        state.idx += 1
      } else if (char == state.bracketStack[state.bracketStack.length-1]) {
        state.bracketStack.pop()
        if (state.bracketStack.length > 0) {
          value = value+char
        } else {
          let v = parseExpression(value)
          if (v !== undefined && v !== null) { result.push(v) }
        }
        state.idx += 1
      } else if (char == ',' && state.bracketStack.length == 1) {
        result.push(parseExpression(value))
        value = ''
        state.idx += 1
      } else {
        value += char
        state.idx += 1
      }
    }
    return result
  }

  let parseValue = (v) => {
    v = v.trim()
    if (v == '') {
      return undefined
    } else if (v.charAt(0) == '(') {
      v = v.replace('(','[').replace(')',']')
      let arrayState = { str:v, idx:0, bracketStack: [], }
      let array = parseArray(arrayState)
      return () => array
    } else if (v.charAt(0) == '[') {
      v = v.toLowerCase()
      if (v.includes('t')) {
        let parts = v.split('t')
        return makeTimeVar(parseExpression(parts[0]), parseExpression(parts[1]))
      } else {
        let arrayState = { str:v, idx:0, bracketStack: [], }
        return parseArray(arrayState)
      }
    } else if (v.toLowerCase().startsWith('vars.')) {
      v = v.toLowerCase().replace('vars.', '')
      return () => vars[v]
    }
    return Function('"use strict";return (' + v + ')')()
  }

  let parseExpression = (v) => {
    // First find operators to split expression into values, then parse values, then reassemble as functions
    return parseValue(v)
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  assert(1, parseExpression('1'))
  assert([1,2], parseExpression('[1,2]'))
  assert([1,[2,3]], parseExpression('[1,[2,3]]'))
  assert([1,[2,3]], parseExpression(' [ 1 , [ 2  , 3 ] ] '))

  let p
  p = parseExpression('(1,2)')
  assert([1,2], p(0))
  assert([1,2], p(1))

  p = parseExpression('[1,(2,3)]')
  assert(1, p[0])
  assert([2,3], p[1]())

  p = parseExpression('[1,2]T1')
  assert(1, p(0))
  assert(1, p(1/2))
  assert(2, p(1))
  assert(2, p(3/2))
  assert(1, p(2))

  p = parseExpression('[1,2]T')
  assert(1, p(0))
  assert(1, p(3.9))
  assert(2, p(4))

  p = parseExpression('[1,2,3]T[1,2]')
  assert(1, p(0))
  assert(2, p(1))
  assert(2, p(2))
  assert(3, p(3))
  assert(1, p(4))

  p = parseExpression('[(0,2),(1,3)]T')
  assert([0,2], p(0)())
  assert([1,3], p(4)())

  vars.foo = 'bar'
  p = parseExpression('vars.foo')
  vars.foo = 'baz'
  assert('baz', p())
  vars.foo = undefined

  vars.foo = 2
  p = parseExpression('[1,vars.foo]')
  vars.foo = 3
  assert(1, p[0])
  assert(3, p[1]())
  vars.foo = undefined

  // p = parseExpression('1+1')
  // assert(2, p(0))
  // assert(2, p(1))

  // p = parseExpression(' [ 1 , 2 ] + 3 ')
  // assert(4, p(0)())
  // assert(5, p(1)())
  // assert(4, p(2)())

  // (1,2)+3 [1,2]+(3,4) [1,2]t1+3 [1,2]t1+(3,4) [(1,2)]+3 [1,2]+[3,4] (1,2)+(3,4) [1,2]+vars.foo
  // [8,9]%7 (8,9)%7

  console.log('Parse expression tests complete')

  return parseExpression
})
