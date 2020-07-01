define(function(require) {

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

  let parseExpression = (v) => {
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
    }
    return Function('"use strict";return (' + v + ')')()
  }

    return parseExpression
})
