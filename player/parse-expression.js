define(function(require) {

  let vars = require('vars')
  let evalParam = require('player/eval-param')

  let evalAdd = (l, r, v,s,b) => {
    l = evalParam(l, v,s,b)
    r = evalParam(r, v,s,b)
    if (typeof l == 'number') {
      if (typeof r == 'number') {
        return l+r
      } else {
        return r.map(x => x+l)
      }
    } else {
      if (typeof r == 'number') {
        return l.map(x => x+r)
      } else {
        let result = []
        for (let i = 0; i < Math.max(l.length, r.length); i++) {
          result.push(l[i % l.length] + r[i % r.length])
        }
        return result
      }
    }
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

  let brackets = {
    '[': ']',
    '(': ')',
    '{': '}',
    '<': '>',
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

  let parseExpression = (v) => {
    v = v.trim().toLowerCase()
    if (v == '') {
      return undefined
    } else if (v.includes('+')) {
      let [l,r] = v.split(/\+(.+)/)
      return (v,s,b) => evalAdd(parseExpression(l), parseExpression(r), v,s,b)
    } else if (v.charAt(0) == '(') {
      v = v.replace('(','[').replace(')',']')
      let arrayState = { str:v, idx:0, bracketStack: [], }
      let array = parseArray(arrayState)
      if (array.length == 1) {
        return array[0]
      } else {
        return () => array
      }
    } else if (v.charAt(0) == '[') {
      if (v.includes('t')) {
        let parts = v.split('t')
        return makeTimeVar(parseExpression(parts[0]), parseExpression(parts[1]))
      } else {
        let arrayState = { str:v, idx:0, bracketStack: [], }
        return parseArray(arrayState)
      }
    } else if (v.startsWith('vars.')) {
      v = v.replace('vars.', '')
      return () => vars[v]
    }
    return Function('"use strict";return (' + v + ')')()
    // gut this, and set it up with a state and a char-by-char parse
     // discard whitespace
     // if first char is bracket, then parse array, then maybe look for 't' and parse rhs
     // if first char is 'v' then parse vars
     // if first char is digit or '-' or ., parse number
     // then, if not at end of string, look for operators and parse rhs expression
     // fold constants with operators (so '1/2' -> 0.5)
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
  assert(1, parseExpression('(1)'))

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

  p = parseExpression('1+1')
  assert(2, p(0))
  assert(2, p(1))

  p = parseExpression(' [ 1 , 2 ] + 3 ')
  assert(4, p(0))
  assert(5, p(1))
  assert(4, p(2))

  p = parseExpression('[1,2]+[3,4] ')
  assert(4, p(0))
  assert(6, p(1))
  assert(4, p(2))

  p = parseExpression('[1,2,3]+[4,5] ')
  assert(5, p(0))
  assert(7, p(1))
  assert(7, p(2))
  assert(6, p(3))

  p = parseExpression('[1,2]t1+3 ')
  assert(4, p(0,0))
  assert(5, p(0,1))
  assert(4, p(0,2))

  p = parseExpression('[1,2]t1+(3,4) ')
  assert([4,5], p(0,0))
  assert([5,6], p(0,1))
  assert([4,5], p(0,2))

  assert(6, parseExpression('1+2+3')())
  assert([4,5], parseExpression('(1,2)+3')())
  assert([8,9], parseExpression('(1,2)+3+4 ')())
  assert([4,6], parseExpression('(1,2)+(3,4) ')())
  assert([5,7,7], parseExpression('(1,2,3)+(4,5) ')())
  assert(3, parseExpression('(1)+2')())
  // assert(3, parseExpression('(1+2)')())
  // assert(6, parseExpression('(1+2)+3')())

  // [1,2]+(3,4) [(1,2)]+3 [1,2]+vars.foo 1+[2,3]+4+[5,6]t1+(7,8) ([1,2]+(3,4))

  console.log('Parse expression tests complete')

  return parseExpression
})
