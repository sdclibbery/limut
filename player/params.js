define(function(require) {

  let parseName = (state) => {
    let name = ''
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char == '=') {
        state.idx += 1
        return name
      } else {
        name = name+char
        state.idx += 1
      }
    }
    return null
  }

  let brackets = {
    '[': ']',
    '(': ')',
    '{': '}',
    '<': '>',
  }

  let parseValue = (state) => {
    let value = ''
    let char
    while (char = state.str.charAt(state.idx)) {
      if (brackets[char]) {
        value = value+char
        state.bracketStack.push(brackets[char])
        state.idx += 1
      } else if (char == state.bracketStack[state.bracketStack.length-1]) {
        value = value+char
        state.bracketStack.pop()
        state.idx += 1
      } else if (char == ',' && state.bracketStack.length == 0) {
        state.idx += 1
        return value
      } else {
        value = value+char
        state.idx += 1
      }
    }
    return value
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

  let parseExpression = (v) => {
    if (typeof v == 'string') {
      v = v.trim()
      if (v == '') {
        return undefined
      } else if (v.charAt(0) == '(') {
        v = v.replace('(','[').replace(')',']')
        let vs = Function('"use strict";return (' + v + ')')()
        return () => vs
      } else if (v.charAt(0) == '[') {
        v = v.toLowerCase()
        if (v.includes('t')) {
          let parts = v.split('t')
          return makeTimeVar(parseExpression(parts[0]), parseExpression(parts[1]))
        }
      }
      return Function('"use strict";return (' + v + ')')()
    }
    return v
  }

  let parseParam = (state) => {
    let name = parseName(state)
    let value = parseValue(state)
    if (name) {
      let v = parseExpression(value.trim())
      state.params[name.toLowerCase().trim()] = v
      return true
    }
    return false
  }

  let parseParams = (paramsStr) => {
    let state = {
      str: paramsStr,
      idx: 0,
      params: {},
      bracketStack: [],
    }
    while (parseParam(state)) {}
    return state.params
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  assert({}, parseParams(''))
  assert({dur:1}, parseParams('dur=1'))
  assert({dur:1}, parseParams('Dur=1'))
  assert({dur:1, oct:4}, parseParams('dur=1, oct=4'))
  assert({dur:4, oct:5, decay:2, attack:2}, parseParams('dur=4, oct=5, decay=2, attack=2'))
  assert({dur:1/2}, parseParams('dur=1/2'))
  assert({dur:[1]}, parseParams('dur=[1]'))
  assert({dur:[1,1]}, parseParams('dur=[1,1]'))
  assert({dur:1, oct:4}, parseParams('dur=1,oct=4'))
  assert({dur:[1,1]}, parseParams(' dur = [ 1 , 1 ] '))
  assert({dur:[1,2], oct:[3, 4]}, parseParams('dur=[1, 2],oct=[3, 4]'))
  assert({dur:[[1,1],[[2],3]], oct:4}, parseParams('dur=[[1,1],[[2],3]],oct=4'))
  assert([1,2], parseParams('dur=(1,2)').dur())

  let p
  p = parseParams('add=[1,2]T1')
  assert(1, p.add(0))
  assert(1, p.add(1/2))
  assert(2, p.add(1))
  assert(2, p.add(3/2))
  assert(1, p.add(2))

  p = parseParams('add=[1,2]T')
  assert(1, p.add(0))
  assert(1, p.add(3.9))
  assert(2, p.add(4))

  p = parseParams('add=[1,2,3]T[1,2]')
  assert(1, p.add(0))
  assert(2, p.add(1))
  assert(2, p.add(2))
  assert(3, p.add(3))
  assert(1, p.add(4))

  console.log("Params tests complete")

  return parseParams
});
