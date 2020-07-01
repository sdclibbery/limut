define(function(require) {
  let parseExpression = require('player/parse-expression')

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

  let parseParam = (state) => {
    let name = parseName(state)
    let value = parseValue(state)
    if (name) {
      state.params[name.toLowerCase().trim()] = parseExpression(value.trim())
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
  assert({dur:[]}, parseParams('dur=[]'))
  assert({dur:[1]}, parseParams('dur=[1]'))
  assert({dur:[1,1]}, parseParams('dur=[1,1]'))
  assert({dur:1, oct:4}, parseParams('dur=1,oct=4'))
  assert({dur:[1,1]}, parseParams(' dur = [ 1 , 1 ] '))
  assert({dur:[1,2], oct:[3, 4]}, parseParams('dur=[1, 2],oct=[3, 4]'))
  assert({dur:[[1,1],[[2],3]], oct:4}, parseParams('dur=[[1,1],[[2],3]],oct=4'))

  let p
  p = parseParams('dur=(1,2)')
  assert([1,2], p.dur(0))
  assert([1,2], p.dur(1))

  p = parseParams('dur=[1,(2,3)]')
  assert(1, p.dur[0])
  assert([2,3], p.dur[1]())

  p = parseParams('dur=[(1,2),(3,4)]')
  assert([1,2], p.dur[0]())
  assert([3,4], p.dur[1]())

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

  p = parseParams('add=[(0,2),(1,3)]T')
  assert([0,2], p.add(0)())
  assert([1,3], p.add(4)())

  console.log("Params tests complete")

  return parseParams
});
