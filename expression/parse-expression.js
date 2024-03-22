'use strict';
define(function(require) {
  let number = require('expression/parse-number')
  let parseMap = require('expression/parse-map')
  let parseArray = require('expression/parse-array')
  let eatWhitespace = require('expression/eat-whitespace')
  let operatorTree = require('expression/parse-operator')
  let {operators} = require('expression/operators')
  let {timeVar, linearTimeVar, smoothTimeVar, eventTimeVar, eventIdxVar} = require('expression/eval-timevars')
  let {parseRandom, simpleNoise} = require('expression/eval-randoms')
  let {parseVar,varLookup} = require('expression/parse-var')
  let {hoistInterval} = require('expression/intervals')
  let addModifiers = require('expression/time-modifiers').addModifiers
  let {evalParamFrame,preEvalParam} = require('player/eval-param')
  let parseColour = require('expression/parse-colour')
  let parseString = require('expression/parse-string')

  let numberOrArray = (state) => {
    let n = number(state)
    if (n !== undefined) {
      return n
    } else {
      if (state.str.charAt(state.idx) == '[') {
        let ds = parseArray(state, '[', ']')
        return ds
      } else {
        return
      }
    }
  }

  let numberOrArrayOrFour = (state) => {
    let n = numberOrArray(state)
    return (n !== undefined) ? n : 4
  }

  let parseInterval = (state) => {
    eatWhitespace(state)
    let result
    if (state.str.charAt(state.idx) == '@') {
      state.idx += 1
      if (state.str.charAt(state.idx) == 'f') {
        state.idx += 1
        result = 'frame'
      } else if (state.str.charAt(state.idx) == 'e') {
        state.idx += 1
        result = 'event'
      }
    }
    return result
  }

  let setInterval = (result, interval) => {
    if (Array.isArray(result)) {
      result.map(v => v.interval = interval)
    } else {
      result.interval = interval
    }
  }

  let expression = (state) => {
    let result
    let operatorList = []
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === '') { break }
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') { state.idx += 1; continue }
      // array / time var / random
      if (char == '[') {
        let vs = parseArray(state, '[', ']')
        if (state.str.charAt(state.idx).toLowerCase() == 't') { // timevar; values per time interval
          state.idx += 1
          let ds = numberOrArrayOrFour(state)
          let modifiers = parseMap(state)
          let interval = parseInterval(state) || hoistInterval('event', vs)
          result = addModifiers(timeVar(vs, ds), modifiers)
          setInterval(result, interval)
        } else if (state.str.charAt(state.idx).toLowerCase() == 'l') { // linearly interpolated timevar
          state.idx += 1
          let ds = numberOrArrayOrFour(state)
          let modifiers = parseMap(state)
          let interval = parseInterval(state) || hoistInterval('event', vs)
          result = addModifiers(linearTimeVar(vs, ds), modifiers)
          setInterval(result, interval)
        } else if (state.str.charAt(state.idx).toLowerCase() == 's') { // smoothstep interpolated timevar
          state.idx += 1
          let ds = numberOrArrayOrFour(state)
          let modifiers = parseMap(state)
          let interval = parseInterval(state) || hoistInterval('event', vs)
          result = addModifiers(smoothTimeVar(vs, ds), modifiers)
          setInterval(result, interval)
        } else if (state.str.charAt(state.idx).toLowerCase() == 'r') { // random
          state.idx += 1
          let hold = number(state)
          let modifiers = parseMap(state)
          let interval = parseInterval(state) || hoistInterval('event', vs, modifiers)
          result = addModifiers(parseRandom(vs, hold, interval), modifiers)
          setInterval(result, interval)
        } else if (state.str.charAt(state.idx).toLowerCase() == 'n') { // simple noise
          state.idx += 1
          let hold = number(state)
          if (hold === undefined) { hold = 1 }
          let modifiers = parseMap(state)
          let interval = parseInterval(state) || hoistInterval('frame', modifiers)
          result = addModifiers(simpleNoise(vs, hold, modifiers, interval), modifiers)
          setInterval(result, interval)
        } else if (state.str.charAt(state.idx).toLowerCase() == 'e') { // interpolate through the event duration
          state.idx += 1
          let ds = numberOrArray(state)
          result = addModifiers(eventTimeVar(vs, ds), parseMap(state))
          setInterval(result, parseInterval(state) || hoistInterval('frame', vs))
        } else { // Basic array: one value per pattern step
          result = addModifiers(eventIdxVar(vs), parseMap(state))
          setInterval(result, parseInterval(state) || hoistInterval('event', vs))
        }
        continue
      }
      // chord
      if (char == '(') {
        let vs = parseArray(state, '(', ')')
        eatWhitespace(state)
        if (vs.length == 1) {
          result = vs[0]
          result = addModifiers(result, parseMap(state))
          let interval = parseInterval(state)
          if (interval && typeof result === 'function') { result.interval = interval }
        } else if (Array.isArray(vs)) {
          result = vs
          result = addModifiers(result, parseMap(state))
          result.interval = parseInterval(state) || hoistInterval('event', vs)
        } else {
          result = vs
        }
        continue
      }
      // map (object)
      if (char == '{') {
        result = parseMap(state)
        result = addModifiers(result, parseMap(state))
        parseInterval(state) // Ignore
        continue
      }
      // operator
      if (result !== undefined) {
        if (operators.hasOwnProperty(char)) {
          state.idx += 1
          operatorList.push(result)
          result = undefined
          operatorList.push(char)
          continue
        }
      }
      // unary minus operator
      let digitChar = (char) => (char >= '0' && char <= '9') || char == '.' || char == 'e'
      if (char === '-' && !digitChar(state.str.charAt(state.idx+1)) ) {
        state.idx += 1
        operatorList.push(-1)
        result = undefined
        operatorList.push('*')
        continue
      }
      // number
      let n = number(state)
      if (n !== undefined) {
        let next = state.str.charAt(state.idx)
        if (next === '#' || next === 'b') { // Allow sharp/flat notation immediately following a number
          state.idx += 1
          n = {value:n}
          n[next] = 1
        }
        result = addModifiers(n, parseMap(state))
        continue
      }
      // string
      if (char == '\'') {
        state.idx += 1
        result = addModifiers(parseString(state), parseMap(state))
        continue
      }
      // colour
      if (char == '#') {
        state.idx += 1
        result = addModifiers(parseColour(state), parseMap(state))
        continue
      }
      // vars
      let parsed = parseVar(state)
      let modifiers = parseMap(state)
      let v = varLookup(parsed, modifiers, state.context)
      if (v !== undefined) {
        result = addModifiers(v, modifiers)
        if (typeof result === 'function') {
          result.interval = parseInterval(state) || 'frame'
        }
        continue
      }
      break
    }
    if (operatorList.length > 0) {
      operatorList.push(result)
      result = operatorTree(operatorList)
    }
    return result
  }

  let parseExpression = (v, context) => {
    if (v == '' || v == undefined) { return }
    v = v.trim()
    let state = {
      str: v,
      idx: 0,
      expression: expression,
      context: context,
      parseInterval: parseInterval,
      hoistInterval: hoistInterval,
      setInterval: setInterval,
    }
    let result = expression(state)
    return result
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let vars = require('vars').all()
  
  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let assertNotEqual = (expected, actual) => {
    if (actual === expected) { console.trace(`Assertion failed.\n>>Expected ${expected}\n to be different than actual: ${actual}`) }
  }
  let assertApprox = (expected, actual) => {
    assertNumber(actual)
    if (actual < expected-0.0001 || actual > expected+0.0001) { console.trace(`Assertion failed.\n>>Expected ${expected}\n>>Actual: ${actual}`) }
  }
  let assertNumber = (v) => {
    if (typeof v !== 'number') { console.trace(`Assertion failed.\n>>Expected ${v} to be a number but was ${typeof v}`) }
  }
  let assertIn = (lo, hi, actual) => {
    assertNumber(actual)
    if (actual < lo-0.0001 || actual > hi+0.0001) { console.trace(`Assertion failed.\n>>Expected ${lo} - ${hi}\n>>Actual: ${actual}`) }
  }
  let assertInteger = (v) => {
    assertNumber(v)
    if (!Number.isInteger(v)) { console.trace(`Assertion failed.\n>>Expected ${v} to be an Integer`) }
  }
  let assertNotInteger = (v) => {
    assertNumber(v)
    if (Number.isInteger(v)) { console.trace(`Assertion failed.\n>>Expected ${v} not to be an Integer`) }
  }
  let assertOneOf = (vs, actual) => {
    if (!vs.includes(actual)) { console.trace(`Assertion failed.\n>>Expected one of ${vs}\n>>Actual: ${actual}`) }
  }

  require('predefined-vars').apply(require('vars').all())
  let {evalParamFrame,preEvalParam} = require('player/eval-param')
  let ev = (i,c,d) => {return{idx:i, count:c, dur:d, _time:c, endTime:c+d, countToTime:x=>x}}

  assert(undefined, parseExpression())
  assert(undefined, parseExpression(''))
  assert(1, parseExpression('1'))
  assert(123, parseExpression('123'))
  assert(1.1, parseExpression('1.1'))
  assert(.123, parseExpression('.123'))
  assert(-1, parseExpression('-1'))
  assert(1e9, parseExpression('1e9'))
  
  assert(1, parseExpression('[1,2]')(ev(0),0,evalParamFrame))
  assert(2, parseExpression('[1,2]')(ev(1),0,evalParamFrame))
  assert(1, parseExpression('[1,2]')(ev(2),0,evalParamFrame))
  assert(1, evalParamFrame(parseExpression('[[1,2]]'),ev(0),0))
  assert(2, evalParamFrame(parseExpression('[[1,2]]'),ev(1),0))
  assert(1, evalParamFrame(parseExpression('[[1,2]]'),ev(2),0))
  assert(1, parseExpression('[1:3]')(ev(0),0,evalParamFrame))
  assert(3, parseExpression('[1:3]')(ev(1),0,evalParamFrame))

  assert(1, parseExpression('(1)'))

  let p
  p = parseExpression('(1,2)')
  assert([1,2], p)

  p = parseExpression('[]')
  assert(0, evalParamFrame(p,ev(0,0),0))
  assert(0, evalParamFrame(p,ev(1,1),1))

  p = parseExpression('[1,2]')
  assert(1, evalParamFrame(p,ev(0,0),0))
  assert(2, evalParamFrame(p,ev(1,1),1))
  assert(1, evalParamFrame(p,ev(2,2),2))

  p = parseExpression('[1,(2,3)]')
  assert([1,1], evalParamFrame(p,ev(0,0),0))
  assert([2,3], evalParamFrame(p,ev(1,1),1))

  p = parseExpression('[(1,2,3),4,(5,6)]')
  assert([1,2,3], evalParamFrame(p,ev(0,0),0))
  assert([4,4], evalParamFrame(p,ev(1,1),1))
  assert([5,6,5], evalParamFrame(p,ev(2,2),2))
  assert([1,2,3], evalParamFrame(p,ev(3,3),3))

  assert(3, parseExpression('1+2'))
  assert(6, parseExpression('1+2+3'))

  p = parseExpression('[1,2]T1@f')
  assert(1, p(ev(0),0,evalParamFrame))
  assert(1, p(ev(0),1/2,evalParamFrame))
  assert(2, p(ev(0),1,evalParamFrame))
  assert(2, p(ev(0),3/2,evalParamFrame))
  assert(1, p(ev(0),2,evalParamFrame))

  p = parseExpression('[1,2]T@f')
  assert(1, p(ev(0),0,evalParamFrame))
  assert(1, p(ev(0),3.9,evalParamFrame))
  assert(2, p(ev(0),4,evalParamFrame))

  p = parseExpression('[1,2,3]t[1,2]@f')
  assert(1, p(ev(0),0,evalParamFrame))
  assert(2, p(ev(0),1,evalParamFrame))
  assert(2, p(ev(0),2,evalParamFrame))
  assert(3, p(ev(0),3,evalParamFrame))
  assert(1, p(ev(0),4,evalParamFrame))

  p = parseExpression('[0:2]t1')
  assert(0, p(ev(0,0),0,evalParamFrame))
  assert(1, p(ev(1,1),1,evalParamFrame))
  assert(2, p(ev(2,2),2,evalParamFrame))
  assert(0, p(ev(3,3),3,evalParamFrame))

  p = parseExpression('[-1:1]t1')
  assert(-1, p(ev(0,0),0,evalParamFrame))
  assert(0, p(ev(1,1),1,evalParamFrame))
  assert(1, p(ev(2,2),2,evalParamFrame))
  assert(-1, p(ev(3,3),3,evalParamFrame))

  p = parseExpression('[0:[1,2]]t1')
  assert(0, p(ev(0,0),0,evalParamFrame))
  assert(1, p(ev(1,1),1,evalParamFrame))
  assert(0, p(ev(2,2),2,evalParamFrame))
  assert(0, p(ev(3,3),3,evalParamFrame))
  assert(0, p(ev(4,4),4,evalParamFrame))
  assert(2, p(ev(5,5),5,evalParamFrame))
  assert(0, p(ev(6,6),6,evalParamFrame))

  p = parseExpression('[0:[1,2]]t[1,2]')
  assert(0, p(ev(0,0),0,evalParamFrame))
  assert(1, p(ev(1,1),1,evalParamFrame))
  assert(1, p(ev(2,2),2,evalParamFrame))
  assert(2, p(ev(3,3),3,evalParamFrame))
  assert(1, p(ev(4,4),4,evalParamFrame))
  assert(1, p(ev(5,5),5,evalParamFrame))
  assert(0, p(ev(6,6),6,evalParamFrame))
  assert(2, p(ev(7,7),7,evalParamFrame))
  assert(1, p(ev(8,8),8,evalParamFrame))

  p = parseExpression('[(0,2),(1,3)]')
  assert([0,2], evalParamFrame(p,ev(0,0),0))
  assert([1,3], evalParamFrame(p,ev(1,1),1))

  p = parseExpression('[(0,2),(1,3)]T@f')
  assert([0,2], evalParamFrame(p,ev(0,0),0))
  assert([1,3], evalParamFrame(p,ev(4,4),4))

  p = parseExpression('[(0,2),(1,3)]l2@f')
  assert([0,2], evalParamFrame(p,ev(0,0),0))
  assert([0.5,2.5], evalParamFrame(p,ev(1,1),1))
  assert([1,3], evalParamFrame(p,ev(2,2),2))

  p = parseExpression('[0,(1,2)]l2@f')
  assert([0,0], evalParamFrame(p,ev(0,0),0))
  assert([0.5,1], evalParamFrame(p,ev(1,1),1))
  assert([1,2], evalParamFrame(p,ev(2,2),2))

  p = parseExpression('[(0,2),(1,3)]s2@f')
  assert([0,2], evalParamFrame(p,ev(0,0),0))
  assert([0.5,2.5], evalParamFrame(p,ev(1,1),1))
  assert([1,3], evalParamFrame(p,ev(2,2),2))

  vars.foo = 'bar'
  p = parseExpression('foo')
  vars.foo = 'baz'
  assert('baz', p({},0,(v)=>v))
  delete vars.foo

  vars['foo'] = 'bar'
  p = parseExpression('FoO')
  assert('bar', p({},0,(v)=>v))
  vars['foo'] = undefined

  vars.foo = 2
  p = parseExpression('[1,foo]')
  vars.foo = 3
  assert(1, evalParamFrame(p, ev(0),0))
  assert(3, evalParamFrame(p, ev(1),1))
  delete vars.foo

  p = parseExpression('-[1,2] ')
  assert(-1, p(ev(0),0, evalParamFrame))
  assert(-2, p(ev(1),1, evalParamFrame))

  p = parseExpression('-(1,2) ')(ev(0),0, evalParamFrame)
  assert([-1,-2], p)

  assert(-1, parseExpression('-(1)'))

  p = parseExpression('[1,2]+[3,4] ')
  assert(4, p(ev(0),0, evalParamFrame))
  assert(6, p(ev(1),1, evalParamFrame))
  assert(4, p(ev(2),2, evalParamFrame))

  p = parseExpression(' [ 1 , 2 ] + 3 ')
  assert(4, p(ev(0),0, evalParamFrame))
  assert(5, p(ev(1),1, evalParamFrame))
  assert(4, p(ev(2),2, evalParamFrame))

  p = parseExpression('1+[2,3]')
  assert(3, p(ev(0),0, evalParamFrame))
  assert(4, p(ev(1),1, evalParamFrame))
  assert(3, p(ev(2),2, evalParamFrame))

  p = parseExpression('[1,2,3]+[4,5] ')
  assert(5, p(ev(0),0, evalParamFrame))
  assert(7, p(ev(1),1, evalParamFrame))
  assert(7, p(ev(2),2, evalParamFrame))
  assert(6, p(ev(3),3, evalParamFrame))

  p = parseExpression('[1,2]t1@f+3 ')
  assert(4, p(ev(0),0, evalParamFrame))
  assert(5, p(ev(0),1, evalParamFrame))
  assert(4, p(ev(0),2, evalParamFrame))

  p = parseExpression('3+[1,2]t1@f ')
  assert(4, p(ev(0),0, evalParamFrame))
  assert(5, p(ev(0),1, evalParamFrame))
  assert(4, p(ev(0),2, evalParamFrame))

  p = parseExpression('[1,2]t1@f+[3,4]t1@f')
  assert(4, p(ev(0),0, evalParamFrame))
  assert(6, p(ev(0),1, evalParamFrame))
  assert(4, p(ev(0),2, evalParamFrame))

  p = parseExpression('2+foo+2')
  vars.foo = parseExpression('[1,2]t1@f')
  assert(5, p(ev(0),0, evalParamFrame))
  assert(6, p(ev(0),1, evalParamFrame))
  assert(5, p(ev(0),2, evalParamFrame))
  vars.foo = parseExpression('5')
  assert(9, p(ev(0),3, evalParamFrame))
  delete vars.foo

  p = parseExpression('[1,[2,3]t2@e]t1@f')
  assert(1, evalParamFrame(p,ev(0,0),0,evalParamFrame))
  assert(2, evalParamFrame(p,ev(0,0),1,evalParamFrame))
  assert(1, evalParamFrame(p,ev(0,0),2,evalParamFrame))
  assert(2, evalParamFrame(p,ev(0,0),3,evalParamFrame))
  assert(1, evalParamFrame(p,ev(0,0),0,evalParamFrame))
  assert(2, evalParamFrame(p,ev(1,1),1,evalParamFrame))
  assert(1, evalParamFrame(p,ev(2,2),2,evalParamFrame))
  assert(3, evalParamFrame(p,ev(3,3),3,evalParamFrame))
  
  p = parseExpression('[1,[2,3]t2@f]t1@e')
  assert(1, evalParamFrame(p,ev(0,0),0,evalParamFrame))
  assert(1, evalParamFrame(p,ev(0,0),1,evalParamFrame))
  assert(1, evalParamFrame(p,ev(0,0),2,evalParamFrame))
  assert(1, evalParamFrame(p,ev(0,0),3,evalParamFrame))
  assert(2, evalParamFrame(p,ev(1,1),0,evalParamFrame))
  assert(2, evalParamFrame(p,ev(1,1),1,evalParamFrame))
  assert(3, evalParamFrame(p,ev(1,1),2,evalParamFrame))
  assert(3, evalParamFrame(p,ev(1,1),3,evalParamFrame))
  
  p = parseExpression('[1,[2,3]t2@e]l1@f')
  assert(1, evalParamFrame(p,ev(0,0),0,evalParamFrame))
  assert(2, evalParamFrame(p,ev(0,0),1,evalParamFrame))
  assert(1, evalParamFrame(p,ev(0,0),2,evalParamFrame))
  assert(2, evalParamFrame(p,ev(0,0),3,evalParamFrame))
  assert(1, evalParamFrame(p,ev(0,0),0,evalParamFrame))
  assert(2, evalParamFrame(p,ev(1,1),1,evalParamFrame))
  assert(1, evalParamFrame(p,ev(2,2),2,evalParamFrame))
  assert(3, evalParamFrame(p,ev(3,3),3,evalParamFrame))

  p = parseExpression('[1,[2,3]l1@f]t2@e')
  assert(1, evalParamFrame(p,ev(0,0),0,evalParamFrame))
  assert(1, evalParamFrame(p,ev(0,0),1,evalParamFrame))
  assert(2, evalParamFrame(p,ev(2,2),2,evalParamFrame))
  assert(3, evalParamFrame(p,ev(2,2),3,evalParamFrame))
  
  p = parseExpression('[1,[2,3]l1@f]t2@e')
  assert(1, evalParamFrame(p,ev(0,0),0,evalParamFrame))
  assert(1, evalParamFrame(p,ev(0,0),1,evalParamFrame))
  assert(2, evalParamFrame(p,ev(2,2),2,evalParamFrame))
  assert(2.5, evalParamFrame(p,ev(2,2),2.5,evalParamFrame))
  assert(3, evalParamFrame(p,ev(2,2),3,evalParamFrame))
  
  assert([4,5], parseExpression('(1,2)+3')(ev(0),0, evalParamFrame))
  assert([4,5], parseExpression('3+(1,2)')(ev(0),0, evalParamFrame))
  assert([8,9], parseExpression('(1,2)+3+4 ')(ev(0),0, evalParamFrame))
  assert([11,12], parseExpression('1+2+(1,2)+3+4 ')(ev(0),0, evalParamFrame))
  assert([4,6], parseExpression('(1,2)+(3,4) ')(ev(0),0, evalParamFrame))
  assert([5,7,7], parseExpression('(1,2,3)+(4,5) ')(ev(0),0, evalParamFrame))
  assert([4,6,6], parseExpression('(1,2)+(3,4,5) ')(ev(0),0, evalParamFrame))
  assert(3, parseExpression('(1)+2'))
  assert(3, parseExpression('(1+2)'))
  assert(6, parseExpression('(1+2)+3'))

  p = parseExpression('[1,2]t1@f+(3,4) ')
  assert([4,5], p(ev(0),0,evalParamFrame))
  assert([5,6], p(ev(0),1,evalParamFrame))
  assert([4,5], p(ev(0),2,evalParamFrame))

  p = parseExpression('foo + (0,2)')
  vars.foo = parseExpression('[1,2]t1@f')
  assert([1,3], p(ev(0),0,evalParamFrame))
  assert([2,4], p(ev(1),1,evalParamFrame))
  delete vars.foo

  p = parseExpression('(foo,[3,4]t1@f)')
  vars.foo = parseExpression('1')
  assert([1,3], evalParamFrame(p,ev(0),0,evalParamFrame))
  assert([1,4], evalParamFrame(p,ev(1),1,evalParamFrame))
  delete vars.foo

  p = parseExpression('[2:8]l[1,0]@f')
  assert(2, evalParamFrame(p,ev(0,0,1),0,evalParamFrame))
  assert(5, evalParamFrame(p,ev(0,0,1),0.5,evalParamFrame))
  assert(2, evalParamFrame(p,ev(1,1,1),1,evalParamFrame))
  assert(5, evalParamFrame(p,ev(1,1,1),1.5,evalParamFrame))
  
  p = parseExpression('[1:[2:8]l[1,0]@f]l1@e')
  assert(1, evalParamFrame(p,ev(0,0,1),0,evalParamFrame))
  assert(1, evalParamFrame(p,ev(0,0,1),0.5,evalParamFrame))
  assert(2, evalParamFrame(p,ev(1,1,1),1,evalParamFrame))
  assert(5, evalParamFrame(p,ev(1,1,1),1.5,evalParamFrame))
  
  p = parseExpression('foo')
  vars.foo = parseExpression('[1:[2:8]l[1,0]@f]l1@e')
  assert(1, evalParamFrame(p,ev(0,0,1),0,evalParamFrame))
  assert(1, evalParamFrame(p,ev(0,0,1),0.5,evalParamFrame))
  assert(2, evalParamFrame(p,ev(1,1,1),1,evalParamFrame))
  assert(5, evalParamFrame(p,ev(1,1,1),1.5,evalParamFrame))
  delete vars.foo

  p = parseExpression('[1,2]+(3,4) ')
  assert([4,5], p(ev(0),0,evalParamFrame))
  assert([5,6], p(ev(1),1,evalParamFrame))
  assert([4,5], p(ev(2),2,evalParamFrame))

  assert(1/2, parseExpression('1/2'))
  assert(1/2, parseExpression('(1/2)'))
  assert([1,2], parseExpression('(2,4)/2')(ev(0),0,evalParamFrame))
  assert(1, parseExpression('[2,4]/2')(ev(0),0,evalParamFrame))
  assert(2, parseExpression('[2,4]/2')(ev(1),1,evalParamFrame))

  assert(4, parseExpression('2+4/2'))
  assert(3, parseExpression('(2+4)/2'))
  assert(4, parseExpression('4/2+2'))
  assert(1, parseExpression('4/(2+2)'))

  assert(10, parseExpression('2+4*2'))
  assert(12, parseExpression('(2+4)*2'))
  assert(16, parseExpression('4*(2+2)'))
  assert(10, parseExpression('4*2+2'))
  assert(33, parseExpression('1+2*3+4*5+6'))
  assert(77, parseExpression('1+2*(3+4)*5+6'))
  assert(157, parseExpression('1+(2*3+4*5)*6'))

  assert(4, parseExpression('2*2'))
  assert([2,4], parseExpression('(1,2)*2')(ev(0),0,evalParamFrame))
  assert(100, parseExpression('[1,2]*100')(ev(0),0,evalParamFrame))
  assert(200, parseExpression('[1,2]*100')(ev(1),1,evalParamFrame))

  assert(1, parseExpression('3%2'))
  assert([1,0], parseExpression('(5,6)%2')(ev(0),0,evalParamFrame))
  assert(2, parseExpression('[5,6]%3')(ev(0),0,evalParamFrame))
  assert(0, parseExpression('[5,6]%3')(ev(1),1,evalParamFrame))

  p = parseExpression('[1,5,7]r')
  for (let i = 0; i<20; i+=1) {
    let v = p(ev(0,0),0,evalParamFrame)
    assertOneOf([1,5,7], v)
    assertInteger(v, 'v:'+v)
  }

  p = parseExpression('[0:9]r')
  for (let i = 0; i<20; i+=1) {
    assertIn(0, 9, p(ev(0,0),0,evalParamFrame))
    assertNotInteger(p(ev(0,0),0,evalParamFrame))
  }

  p = parseExpression('[[0,10]:[9,19]]r')
  for (let i = 0; i<20; i+=1) {
    assertIn(0, 9, evalParamFrame(p,ev(0),0))
    assertNotInteger(evalParamFrame(p,ev(0),0))
  }
  for (let i = 0; i<20; i+=1) {
    assertIn(10, 19, evalParamFrame(p,ev(1),1))
    assertNotInteger(evalParamFrame(p,ev(1),1))
  }

  p = parseExpression('[:9]r')
  for (let i = 0; i<20; i+=1) {
    assertIn(0, 9, evalParamFrame(p,ev(0,0),0))
    assertNotInteger(evalParamFrame(p,ev(0,0),0))
  }

  p = parseExpression('[9]r')
  for (let i = 0; i<20; i+=1) {
    assert(9, evalParamFrame(p,ev(0,0),0))
  }

  p = parseExpression('[0.1:9]r')
  for (let i = 0; i<20; i+=1) {
    assertIn(0.1, 9, evalParamFrame(p,ev(0,0),0))
    assertNotInteger(evalParamFrame(p,ev(0,0),0))
  }

  assert(1, parseExpression('2-1'))

  p = parseExpression('[0,2]l2@f')
  assert(0, evalParamFrame(p,ev(0),0))
  assert(1/2, evalParamFrame(p,ev(1/2),1/2))
  assert(1, evalParamFrame(p,ev(1),1))
  assert(2, evalParamFrame(p,ev(2),2))
  assert(1, evalParamFrame(p,ev(3),3))
  assert(0, evalParamFrame(p,ev(4),4))

  p = parseExpression('[0:2]l2@f')
  assert(0, evalParamFrame(p,ev(0),0))
  assert(1, evalParamFrame(p,ev(1),1))
  assert(2, evalParamFrame(p,ev(2),2))
  assert(1, evalParamFrame(p,ev(3),3))
  assert(0, evalParamFrame(p,ev(4),4))

  p = parseExpression('[0,1]s1@f')
  assert(0, p(ev(0),0,evalParamFrame))
  assertIn(0.1, 0.4, p(ev(1/4),1/4,evalParamFrame))
  assert(1/2, p(ev(1/2),1/2,evalParamFrame))
  assertIn(0.6, 0.9, p(ev(3/4),3/4,evalParamFrame))
  assert(1, p(ev(1),1,evalParamFrame))
  assertIn(0.6, 0.9, p(ev(5/4),5/4,evalParamFrame))
  assert(1/2, p(ev(3/2),3/2,evalParamFrame))
  assertIn(0.1, 0.4, p(ev(7/4),7/4,evalParamFrame))
  assert(0, p(ev(2),2,evalParamFrame))

  p = parseExpression('[1,2]T0.5@f')
  assert(1, p(ev(0),0,evalParamFrame))
  assert(2, p(ev(1/2),1/2,evalParamFrame))
  assert(1, p(ev(1),1,evalParamFrame))

  p = parseExpression('[1,2]T1/2@f')
  assert(1, p(ev(0),0,evalParamFrame))
  assert(2, p(ev(1/2),1/2,evalParamFrame))
  assert(1, p(ev(1),1,evalParamFrame))

  assert({x:0}, parseExpression('{x:0}'))
  assert({x:0}, parseExpression(' { x : 0 } '))
  assert({x:0}, parseExpression('{X:0}'))
  assert({x:1,y:2}, parseExpression('{x:1,y:2}'))
  assert({x:1/2}, parseExpression('{x:1/2}'))
  assert({x:2}, parseExpression('{x:1+1}'))

  p = parseExpression('{x:[1,2]}')
  assert(1, p.x(ev(0),0,evalParamFrame))
  assert(2, p.x(ev(1),1,evalParamFrame))
  assert(undefined, p.x[2])

  assert('a', parseExpression("'a'"))
  assert(' a B c ', parseExpression("' a B c '"))

  assert({r:0,g:0.2,b:0.4,a:1}, parseExpression("#036f"))
  assert({r:0,g:0.2,b:0.4,a:1}, parseExpression("#003366ff"))

  assert({r:2}, parseExpression("{r:1}*2")(ev(0,0),0,evalParamFrame))

  p = parseExpression("[1,2]t2/2@f")
  assert(1, p(ev(0),0,evalParamFrame))
  assert(2, p(ev(1),1,evalParamFrame))
  assert(1, p(ev(2),2,evalParamFrame))

  p = parseExpression("[0,1]t1/4@f")
  assert(0, p(ev(0),0/4,evalParamFrame))
  assert(1, p(ev(0),1/4,evalParamFrame))
  assert(0, p(ev(0),2/4,evalParamFrame))

  p = parseExpression("[1,2]t2@f*2")
  assert(2, p(ev(0),0,evalParamFrame))
  assert(2, p(ev(1),1,evalParamFrame))
  assert(4, p(ev(2),2,evalParamFrame))
  assert(4, p(ev(3),3,evalParamFrame))
  assert(2, p(ev(4),4,evalParamFrame))

  assert('http://a.com/Bc.mp3', parseExpression("'http://a.com/Bc.mp3'"))

  assert(2, parseExpression("[1]+1")(ev(0),0,evalParamFrame))

  p = parseExpression("[#f00f,#00ff]t1@f")
  assert({r:1,g:0,b:0,a:1}, evalParamFrame(p,ev(0),0,evalParamFrame))
  assert({r:0,g:0,b:1,a:1}, evalParamFrame(p,ev(1),1,evalParamFrame))

  p = parseExpression('[1,2]r1@f')
  let v0 = p(ev(0,0),0,evalParamFrame)
  for (let i = 0; i<20; i+=1) { assert(v0, p(ev(0),0,evalParamFrame)) }
  let v1 = p(ev(1),1,evalParamFrame)
  for (let i = 0; i<20; i+=1) { assert(v1, p(ev(1),1,evalParamFrame)) }

  assert('ab', parseExpression("'a'+'b'"))

  assert('a\nb', parseExpression("'a\\nb'"))

  assert('event', parseExpression("[0,1]r").interval)
  assert('event', parseExpression("[0:1]r").interval)
  assert('event', parseExpression("[0,1]r4").interval)
  assert('frame', parseExpression("[0,1]r@f").interval)
  assert('frame', parseExpression("[0,1]r @f").interval)
  assert('event', parseExpression("[0,1]r@e").interval)
  assert('event', parseExpression("[0:1]r@e").interval)

  assert('event', parseExpression("[0,1]").interval)
  assert('event', parseExpression("[0,1]t4").interval)
  assert('frame', parseExpression("[0,1]t4@f").interval)
  assert('frame', parseExpression("[0,1]t1/4@f").interval)
  assert('event', parseExpression("[0,1]@e").interval)
  assert('event', parseExpression("[0,1]t@e").interval)
  assert('event', parseExpression("[0,1]t4@e").interval)

  assert('event', parseExpression("[0,1]l4").interval)
  assert('frame', parseExpression("[0,1]l4@f").interval)
  assert('event', parseExpression("[0,1]l4@e").interval)

  assert('event', parseExpression("[0,1]s4").interval)
  assert('frame', parseExpression("[0,1]s4@f").interval)
  assert('event', parseExpression("[0,1]s4@e").interval)

  assert('event', parseExpression("(0,1)").interval)
  assert(undefined, parseExpression("(0,[0:1]r@f)")[0].interval)
  assert('frame', parseExpression("(0,[0:1]r@f)").interval)
  assert('frame', parseExpression("(0,[0:1]r@f)")[1].interval)

  assert(undefined, parseExpression("{a:0}").interval)
  assert(undefined, parseExpression("{a:0}@e").interval)
  assert(undefined, parseExpression("{a:0}@f").interval)
  assert(undefined, parseExpression("{a:[0,1]l@e}").interval)
  assert(undefined, parseExpression("{a:[0,1]l@f}").interval)

  p = parseExpression('foo')
  vars.foo = parseExpression('0')
  assert('frame', p.interval)
  delete vars.foo

  p = parseExpression('foo@e')
  vars.foo = parseExpression('0')
  assert('event', p.interval)
  delete vars.foo

  p = parseExpression('foo@f')
  vars.foo = parseExpression('0')
  assert('frame', p.interval)
  delete vars.foo

  assertApprox(0, parseExpression("[0,1]l0.1@f")(ev(0,0),0,evalParamFrame))
  assertApprox(1, parseExpression("[0,1]l0.1@f")(ev(0,0),0.1,evalParamFrame))
  assertApprox(0, parseExpression("[0,1]l0.1@f")(ev(0,0),1,evalParamFrame))

  assert(0, parseExpression("[0,1]t1@e")(ev(0,1),0,evalParamFrame))
  assert(1, parseExpression("[0,1]t1@f")(ev(0,0),1,evalParamFrame))
  assert(0, parseExpression("[0,1]l1@e")(ev(0,1),0,evalParamFrame))
  assert(1, parseExpression("[0,1]l1@f")(ev(0,0),1,evalParamFrame))
  assert(0, parseExpression("[0,1]s1@e")(ev(0,1),0,evalParamFrame))
  assert(1, parseExpression("[0,1]s1@f")(ev(0,0),1,evalParamFrame))

  let r
  p = parseExpression("[0:1]r1")
  r = p(ev(0,0),0,evalParamFrame)
  for (let i=0; i<20; i++) { assert(r, p(ev(0,0),0,evalParamFrame)) }
  assertNotEqual(r, p(ev(1,1),1,evalParamFrame))

  p = parseExpression("[0:1]r1@e")
  r = p(ev(0,0),0,evalParamFrame)
  for (let i=0; i<20; i++) { assert(r, p(ev(0,0),0,evalParamFrame)) }
  assertNotEqual(r, p(ev(1,1),1,evalParamFrame))

  p = parseExpression("[0:1]r1@f")
  r = p(ev(0,0),0,evalParamFrame)
  for (let i=0; i<20; i++) { assert(r, p(ev(0,0),0,evalParamFrame)) }
  assertNotEqual(r, p(ev(0,0),1,evalParamFrame))

  let e
  p = parseExpression("[0:1]e")
  e = { idx:0, count:7, countToTime:b=>b, _time:7, endTime:8 }
  assert(0, p(e,6, evalParamFrame))
  assert(0, p(e,7, evalParamFrame))
  assert(0.5, p(e,7.5, evalParamFrame))
  assertApprox(1, p(e,8, evalParamFrame))
  assertApprox(1, p(e,9, evalParamFrame))

  p = parseExpression("[0:1]e2")
  e = { idx:0, count:7, countToTime:b=>b, _time:7, endTime:8 }
  assert(1, p(e,6, evalParamFrame))
  assert(0, p(e,7, evalParamFrame))
  assert(0.5, p(e,8, evalParamFrame))
  assert(1, p(e,9, evalParamFrame))
  assert(1, p(e,10, evalParamFrame))

  p = parseExpression("[0,1,0]e")
  e = { idx:0, count:7, countToTime:b=>b, _time:7, endTime:8 }
  assert(0, p(e,6, evalParamFrame))
  assert(0, p(e,7, evalParamFrame))
  assert(1, p(e,7.5, evalParamFrame))
  assertApprox(0, p(e,8, evalParamFrame))
  assertApprox(0, p(e,9, evalParamFrame))

  p = parseExpression("[0:1]e")
  e = { idx:0, count:7, countToTime:b=>b, _time:1, endTime:3 }
  assert(0, p(e,1, evalParamFrame))
  assert(0.5, p(e,2, evalParamFrame))
  assertApprox(1, p(e,3, evalParamFrame))

  p = parseExpression("[0,1,0]e")
  e = { idx:0, count:7, countToTime:b=>b, _time:1, endTime:3 }
  assert(0, p(e,1, evalParamFrame))
  assert(1, p(e,2, evalParamFrame))
  assertApprox(0, p(e,3, evalParamFrame))

  p = parseExpression("[1]e")
  e = { idx:0, count:7, countToTime:b=>b, _time:1, endTime:2 }
  assert(1, p(e,0, evalParamFrame))
  assert(1, p(e,1, evalParamFrame))
  assert(1, p(e,2, evalParamFrame))
  assert(1, p(e,3, evalParamFrame))

  p = parseExpression("[]e")
  e = { idx:0, count:7, countToTime:b=>b, _time:1, endTime:2 }
  assert(0, p(e,0, evalParamFrame))
  assert(0, p(e,1, evalParamFrame))
  assert(0, p(e,2, evalParamFrame))
  assert(0, p(e,3, evalParamFrame))

  p = parseExpression("[0:1]e1/2")
  e = { idx:0, count:7, countToTime:b=>b, _time:7, endTime:8 }
  assert(0, p(e,6, evalParamFrame))
  assert(0, p(e,7, evalParamFrame))
  assert(0.5, p(e,7.25, evalParamFrame))
  assert(1, p(e,7.5, evalParamFrame))
  assert(1, p(e,8, evalParamFrame))
  assert(1, p(e,9, evalParamFrame))

  p = parseExpression("[0,1,2]e[2,1]")
  e = { idx:0, count:0, countToTime:b=>b, _time:0, endTime:3 }
  assert(0, p(e,0, evalParamFrame))
  assert(0.5, p(e,1, evalParamFrame))
  assert(1, p(e,2, evalParamFrame))
  assert(2, p(e,3, evalParamFrame))
  assert(2, p(e,4, evalParamFrame))

  p = parseExpression('[(0,2),(1,3)]e')
  e = { idx:0, count:0, countToTime:b=>b, _time:0, endTime:1 }
  assert([0,2], evalParamFrame(p,e,0,evalParamFrame))
  assert([0.5,2.5], evalParamFrame(p,e,1/2,evalParamFrame))
  assert([0.9999989999999999,2.999999], evalParamFrame(p,e,2,evalParamFrame))

  p = parseExpression("[0:1]e")
  let e1 = { idx:0, count:7, countToTime:b=>b, _time:7, endTime:70 }
  let e2 = { idx:0, count:7, countToTime:b=>b, _time:7, endTime:8 }
  assertApprox(0.015873015873015872, p(e1,8, evalParamFrame))
  assertApprox(1, p(e2,8, evalParamFrame))

  assert(1, parseExpression("[1,0]t1")(ev(0,0),0,evalParamFrame))
  assert(0, parseExpression("[1,0]t1")(ev(1,1),1,evalParamFrame))
  assert(1, parseExpression("[1,0]l1")(ev(0,0),0,evalParamFrame))
  assert(0, parseExpression("[1,0]l1")(ev(1,1),1,evalParamFrame))

  p = parseExpression("[1000:100]e")
  e = { idx:0, count:7, countToTime:b=>b, _time:7, endTime:8 }
  assert(550, evalParamFrame(p,e,7.5))

  let last, min, max
  p = parseExpression("[]n")
  e = ev(0,0)
  last = undefined
  for (let b= 0; b<1; b+=0.01) {
    let current = p(e,b,evalParamFrame)
    if (last === undefined) { last = current-0.01 }
    assertIn(0, 1, current)
    assertNotEqual(last, current)
    assertIn(last-0.1, last+0.1, current)
    last = current
  }
  min=1
  max=-1
  for (let b= 0; b<200; b+=0.2) {
    let current = p(e,b,evalParamFrame)
    min = Math.min(min, current)
    max = Math.max(max, current)
  }
  assertIn(0, 0.11, min)
  assertIn(0.89, 1, max)

  p = parseExpression("[-1/8:5/8]n")
  e = ev(0,0)
  last = undefined
  for (let b= 0; b<1; b+=0.01) {
    let current = p(e,b,evalParamFrame)
    if (last === undefined) { last = current-0.01 }
    assertIn(-1/8,5/8, current)
    assertNotEqual(last, current)
    assertIn(last-0.05, last+0.05, current)
    last = current
  }

  assertIn(3/8,5/8, parseExpression("[3/8:5/8]n4")(ev(0,0),0,evalParamFrame))

  p = parseExpression("[[1,5]t1:[2,6]t1]n")
  assertIn(1, 2, evalParamFrame(p,ev(0,0),0))
  assertIn(5, 6, evalParamFrame(p,ev(1,1),1))

  p = parseExpression("[1:1]r-[0:2]e")
  e = { idx:0, count:7, countToTime:b=>b, _time:7, endTime:8 }
  assert(1, evalParamFrame(p,e,7))
  assert(0, evalParamFrame(p,e,7.5))
  assertApprox(-1, evalParamFrame(p,e,8))

  p = parseExpression("[]r")
  for (let i=0; i<20; i++) { assertIn(0,1, p(ev(0,0),0,evalParamFrame)) }

  assert(8, parseExpression('2^3'))
  assert(18, parseExpression('2*3^2'))
  assert(36, parseExpression('(2*3)^2'))
  assert(2, parseExpression('4^1/2'))
  assert(0, parseExpression('-1^1/2'))

  vars.foo = () => 5
  vars.foo.isVarFunction = true
  assert({_state:{},value:'foo'}, evalParamFrame(parseExpression('foo'),ev(0,0),0))
  delete vars.foo

  vars.foo = () => 5
  vars.foo.isVarFunction = true
  assert({_state:{},value:'foo'}, evalParamFrame(parseExpression('foo{}'),ev(0,0),0))
  delete vars.foo

  vars.foo = ({value}) => value
  vars.foo.isVarFunction = true
  assert(5, evalParamFrame(parseExpression('foo{5}'),ev(0,0),0))
  delete vars.foo

  vars.foo = ({value}) => value
  vars.foo.isVarFunction = true
  assert(7, parseExpression('foo{5}+2')(ev(0,0),0,evalParamFrame))
  delete vars.foo

  vars.foo = ({value}) => value
  vars.foo.isVarFunction = true
  assert(6, evalParamFrame(parseExpression('  foo  {  x:3, 6 }  '),ev(0,0),0))
  delete vars.foo

  assert('event', parseExpression("[0,24]r").interval)
  assert('event', parseExpression("[0:24]r").interval)
  assert('frame', parseExpression("[0,24]e").interval)
  assert('frame', parseExpression("[0,[0,24]e]r").interval)
  assert('frame', parseExpression("[0,[0,24]e]r1").interval)
  assert('frame', parseExpression("[0,[0:24]e]r").interval)
  assert('frame', parseExpression("[0,[0:24]e]r1").interval)
  assert('frame', parseExpression("[0:[0,24]e]r").interval)
  assert('frame', parseExpression("[0:[0,24]e]r1").interval)
  assert('frame', parseExpression("[0:[0:24]e]r").interval)
  assert('frame', parseExpression("[0:[0:24]e]r1").interval)
  assert('frame', parseExpression("[[0:24]e:0]r").interval)
  assert('frame', parseExpression("[[0:24]e:0]r1").interval)
  assert('frame', parseExpression("[0,[0,24]r]e").interval)
  assert('event', parseExpression("[0,[0,24]r]e@e").interval)
  assert('event', parseExpression("[0,[0,24]e]r@e").interval)
  assert('frame', parseExpression("[0,[0,24]r@e]e").interval)
  assert('event', parseExpression("[0,[0,24]e@e]r").interval)
  assert('frame', parseExpression("[0,24]r@f").interval)
  assert('frame', parseExpression("[0,[0,24]e]n").interval)
  assert('frame', parseExpression("[0,[0,24]n]e").interval)
  assert('event', parseExpression("[0,[0,24]e]n@e").interval)
  assert('event', parseExpression("[0,[0,24]n]e@e").interval)
  assert('frame', parseExpression("[0,[0,24]e]t").interval)
  assert('frame', parseExpression("[0,[0,24]t]e").interval)
  assert('event', parseExpression("[0,[0,24]e]t@e").interval)
  assert('event', parseExpression("[0,[0,24]t]e@e").interval)
  assert('frame', parseExpression("[0,[0,24]e]l").interval)
  assert('frame', parseExpression("[0,[0,24]l]e").interval)
  assert('event', parseExpression("[0,[0,24]e]l@e").interval)
  assert('event', parseExpression("[0,[0,24]l]e@e").interval)
  assert('frame', parseExpression("[0,[0,24]e]s").interval)
  assert('frame', parseExpression("[0,[0,24]s]e").interval)
  assert('event', parseExpression("[0,[0,24]e]s@e").interval)
  assert('event', parseExpression("[0,[0,24]s]e@e").interval)
  assert('frame', parseExpression("[0,[0,24]e]").interval)
  assert('frame', parseExpression("[0,[0,24]]e").interval)
  assert('event', parseExpression("[0,[0,24]e]@e").interval)
  assert('frame', parseExpression("[0,[0,24]e]@f").interval)
  assert('frame', parseExpression("[0.1,(0.1,5)]t1/4@f").interval)
  assert('frame', parseExpression("[0.1,(0.1,5)]l1/4@f").interval)
  assert('frame', parseExpression("[0.1,(0.1,5)]s1/4@f").interval)
  assert('frame', parseExpression("[0.1,(0.1,5)]e").interval)
  assert('frame', parseExpression("[]r@f").interval)
  assert('event', parseExpression("[]r").interval)
  assert('event', parseExpression("[]r1").interval)
  assert('event', parseExpression("[]r{seed:1}").interval)
  assert('event', parseExpression("[]r{seed:1+2}").interval)
  assert('event', parseExpression("[]r{seed:[]r}").interval)
  assert('frame', parseExpression("[]r{seed:[]e}").interval)
  assert('event', parseExpression("[]r{seed:1,per:1}").interval)
  assert('frame', parseExpression("[]r{seed:1,per:[]e}").interval)

  assert([0,0], evalParamFrame(parseExpression("[0,(0,0)]n@f"),ev(0,0),0,evalParamFrame))
  assert('frame', parseExpression("[0.1,(0.1,5)]n@f").interval)

  assert([0,0], evalParamFrame(parseExpression("[(0,0),(0,0)]r@f"), ev(0,0),0,evalParamFrame))
  assert('frame', parseExpression("[0.1,(0.1,5)]r@f").interval)

  assert({x:[1,2]}, parseExpression("{x:(1,2)}"))

  assert([1,2], parseExpression("((1,2))"))
  assert([1,[2,3]], parseExpression("(1,(2,3))"))
  assert([[1,2],3], parseExpression("((1,2),3))"))

  assert([{x:0},{x:[1,2]}], parseExpression("({x:0},{x:(1,2)})"))
  assert([{x:1},{x:2}], evalParamFrame(parseExpression("{x:(1,2)}"), ev(0,0),0))
  assert([{x:0},{x:1},{x:2}], evalParamFrame(parseExpression("({x:0},{x:(1,2)})"), ev(0,0),0))


  vars['green'] = parseExpression('{r:0,g:0.8,b:0,a:1}')
  vars['blue'] = parseExpression('{r:0,g:0.6,b:1,a:1}')
  p = parseExpression("[green:blue]r")
  r = evalParamFrame(p,ev(0,0),0)
  assert(0, r.r)
  assertIn(0, 1, r.g)
  assertIn(0, 1, r.b)
  assert(1, r.a)

  vars.foo = parseExpression("1")
  p = parseExpression("[]r{seed:foo}")
  assert(0.3853306171949953, evalParamFrame(p,ev(0,0),0))
  delete vars.foo

  p = parseExpression("[]r{seed:[1]r4,per:1}")
  assert(0.3853306171949953, evalParamFrame(p,ev(0,0),0))
  assert(0.3853306171949953, evalParamFrame(p,ev(1,1),1))
  assert(0.3853306171949953, evalParamFrame(p,ev(2,2),2))

  vars.red = parseExpression("{r:1}")
  vars.green = parseExpression("{g:1}")
  p = parseExpression("[red,green]t1")
  assert({g:1,r:0}, evalParamFrame(p,ev(1,1),1))
  delete vars.red
  delete vars.green

  p = parseExpression("[0,1]t1{per:1}")
  assert(0, evalParamFrame(p,ev(0,0),0))
  assert(0, evalParamFrame(p,ev(1,1),1))

  p = parseExpression("[0,1]l1{per:1}")
  assert(0, evalParamFrame(p,ev(0,0),0))
  assert(0, evalParamFrame(p,ev(1,1),1))

  p = parseExpression("[0,1]s1{per:1}")
  assert(0, evalParamFrame(p,ev(0,0),0))
  assert(0, evalParamFrame(p,ev(1,1),1))

  p = parseExpression("[0:1]e{per:1/2}")
  e = { idx:0, count:0, countToTime:b=>b, _time:0, endTime:1 }
  assert(0, evalParamFrame(p,e,0))
  assert(1/4, evalParamFrame(p,e,1/4))
  assert(0, evalParamFrame(p,e,1/2))
  assert(1/4, evalParamFrame(p,e,3/4))

  p = parseExpression("[0,1]{per:1}")
  assert(0, evalParamFrame(p,ev(0,0),0))
  assert(1, evalParamFrame(p,ev(1,1),1)) // idx not affected by per

  p = parseExpression('(1,2){per:1}')
  assert([1,2], evalParamFrame(p,ev(0,0),0))

  p = parseExpression('{foo:2}{per:1}')
  assert({foo:2}, evalParamFrame(p,ev(0,0),0))

  p = parseExpression('5{per:1}')
  assert(5, evalParamFrame(p,ev(0,0),0))

  p = parseExpression("'foo'{per:1}")
  assert('foo', evalParamFrame(p,ev(0,0),0))

  vars.foo = parseExpression('[0,1]t1@f')
  p = parseExpression('foo{per:1}')
  assert(0, evalParamFrame(p,ev(0,0),0))
  assert(0, evalParamFrame(p,ev(1,1),1))
  delete vars.foo

  p = parseExpression('[0,1]t1{per:1}@e')
  assert(0, evalParamFrame(p,ev(0,0),0))
  assert(0, evalParamFrame(p,ev(1,1),1))

  vars.foo = parseExpression('[0,1]t1{per:1}@e')
  p = parseExpression('foo')
  assert(0, evalParamFrame(p,ev(0,0),0))
  assert(0, evalParamFrame(p,ev(1,1),1))
  delete vars.foo

  vars.foo = parseExpression('[0,1]t1@e')
  p = parseExpression('foo{per:1}')
  assert(0, evalParamFrame(p,ev(0,0),0))
  assert(0, evalParamFrame(p,ev(1,1),1))
  delete vars.foo

  p = parseExpression('5{per:2,0:1}')
  assert(1, evalParamFrame(p,ev(0,0),0))
  assert(5, evalParamFrame(p,ev(1,1),1))
  assert(1, evalParamFrame(p,ev(2,2),2))
  assert(5, evalParamFrame(p,ev(3,3),3))

  p = parseExpression('[0:1]r{seed:1,per:2}')
  assert(0.3853306171949953, evalParamFrame(p,ev(0,0),0))
  assert(0.8534541970584542, evalParamFrame(p,ev(1,1),1))
  assert(0.3853306171949953, evalParamFrame(p,ev(2,2),2))
  assert(0.8534541970584542, evalParamFrame(p,ev(3,3),3))

  p = parseExpression('[0:1]r{seed:[1,100]t1,per:1}')
  assert(0.3853306171949953, evalParamFrame(p,ev(0,0),0))
  assert(0.19610000611282885, evalParamFrame(p,ev(1,1),1))
  assert(0.3853306171949953, evalParamFrame(p,ev(2,2),2))
  assert(0.19610000611282885, evalParamFrame(p,ev(3,3),3))

  assert(1, evalParamFrame(parseExpression('(1,2).0'),ev(0,0),0))
  assert(2, evalParamFrame(parseExpression('(1,2).1'),ev(0,0),0))
  assert(1, evalParamFrame(parseExpression('(1,2).2'),ev(0,0),0))
  assert(1, evalParamFrame(parseExpression('(1,2).(0.8)'),ev(0,0),0))
  assert(1, evalParamFrame(parseExpression(' ( 1 , 2 )  . 0  @e'),ev(0,0),0))

  p = parseExpression('([3,4]t1,2).0')
  assert(3, evalParamFrame(p,ev(0,0),0))
  assert(4, evalParamFrame(p,ev(1,1),1))

  p = parseExpression('(1,2).[0,1]t1')
  assert(1, evalParamFrame(p,ev(0,0),0))
  assert(2, evalParamFrame(p,ev(1,1),1))

  p = parseExpression('(1,2){per:2,0:5}@f.0')
  assert(5, evalParamFrame(p,ev(0,0),0))
  assert(1, evalParamFrame(p,ev(1,1),1))
  assert(5, evalParamFrame(p,ev(2,2),2))
  assert(1, evalParamFrame(p,ev(3,3),3))

  p = parseExpression('[[1,2]t2]r{seed:0,per:1}')
  assert(1, evalParamFrame(p,ev(0,0),0))
  assert(1, evalParamFrame(p,ev(1,1),1))
  assert(2, evalParamFrame(p,ev(2,2),2))
  assert(2, evalParamFrame(p,ev(3,3),3))
  assert(1, evalParamFrame(p,ev(4,4),4))

  p = parseExpression('[0,[2,4,7]t4]l2{per:4}')
  assert(0, evalParamFrame(p,ev(0,0),0))
  assert(1, evalParamFrame(p,ev(1,1),1))
  assert(2, evalParamFrame(p,ev(2,2),2))
  assert(1, evalParamFrame(p,ev(3,3),3))
  assert(0, evalParamFrame(p,ev(4,4),4))
  assert(4, evalParamFrame(p,ev(6,6),6))
  assert(0, evalParamFrame(p,ev(8,8),8))
  assert(7, evalParamFrame(p,ev(10,10),10))

  assert(1, evalParamFrame(parseExpression('[1]r{}'),ev(0,0),0))

  assert(0, evalParamFrame(parseExpression('().max'),ev(0,0),0))
  assert(3, evalParamFrame(parseExpression('(1,2,3).max'),ev(0,0),0))
  assert(3, evalParamFrame(parseExpression('(1,2,[3,4]t1).max'),ev(0,0),0))
  assert(4, evalParamFrame(parseExpression('(1,2,[3,4]t1).max'),ev(1,1),1))
  assert(3, evalParamFrame(parseExpression('(1,(2,3)).max'),ev(0,0),0))

  assert('frame', parseExpression('(0,[1,2]l1/2@f)').interval)
  assert('frame', parseExpression('(0,[1,2]l1/2@f).max').interval)
  assert({_state:{},value:'min'}, evalParamFrame(parseExpression('min'),ev(0,0),0))

  assert(1, evalParamFrame(parseExpression('[(1,2),(3,4)]t1 .0'),ev(0,0),0))
  assert(3, evalParamFrame(parseExpression('[(1,2),(3,4)]t1 .0'),ev(1,1),1))
  assert(2, evalParamFrame(parseExpression('[(1,2),(3,4)]t1 .1'),ev(0,0),0))
  assert(4, evalParamFrame(parseExpression('[(1,2),(3,4)]t1 .1'),ev(1,1),1))
 
  vars.foo = parseExpression('3')
  p = parseExpression('(1,(2,foo))')
  assert([1,2,3], evalParamFrame(p,ev(0,0),0))
  delete vars.foo

  assert(2, evalParamFrame(parseExpression("{foo:2}.foo"),ev(0,0),0))
  assert(3, evalParamFrame(parseExpression("{foo:[2:3]t1}.foo"),ev(1,1),1))
  assert(2, evalParamFrame(parseExpression("{foo:2,bar:3}.['foo','bar']t1"),ev(0,0),0))
  assert(3, evalParamFrame(parseExpression("{foo:2,bar:3}.['foo','bar']t1"),ev(1,1),1))

  assert({foo:2,bar:3}, evalParamFrame(parseExpression("{foo:2,bar:3}.max"),ev(0,0),0))

  assert({value:0,'#':1}, evalParamFrame(parseExpression("0#"),ev(0,0),0))
  assert({value:2,b:1}, evalParamFrame(parseExpression("2b"),ev(0,0),0))

  vars.e = 1
  p = parseExpression('e')
  assert(1, p({},0,(v)=>v))
  delete vars.e

  assert(0, evalParamFrame(parseExpression("[0,1]t1/4{per:1}@f"),ev(0,0,1),0))
  assert(1, evalParamFrame(parseExpression("[0,1]t1/4{per:1}@f"),ev(0,0,1),1/4))
  assert(0, evalParamFrame(parseExpression("[0,1]t1/4{per:1}@f"),ev(0,0,1),1/2))
  assert(1, evalParamFrame(parseExpression("[0,1]t1/4{per:1}@f"),ev(0,1,1),3/4))

  assert(0, evalParamFrame(parseExpression("[0,1]e"),ev(0,0,1),0))
  assert(1/4, evalParamFrame(parseExpression("[0,1]e"),ev(0,0,1),1/4))
  assert(1/2, evalParamFrame(parseExpression("[0,1]e"),ev(0,0,1),1/2))
  assert(3/4, evalParamFrame(parseExpression("[0,1]e"),ev(0,0,1),3/4))
  assert(0, evalParamFrame(parseExpression("[0,1]e"),ev(0,1,1),1))

  assert(0, evalParamFrame(parseExpression("[0,1]e{per:1}"),ev(0,0,1),0))
  assert(1/4, evalParamFrame(parseExpression("[0,1]e{per:1}"),ev(0,0,1),1/4))
  assert(1/2, evalParamFrame(parseExpression("[0,1]e{per:1}"),ev(0,0,1),1/2))
  assert(3/4, evalParamFrame(parseExpression("[0,1]e{per:1}"),ev(0,0,1),3/4))
  assert(0, evalParamFrame(parseExpression("[0,1]e{per:1}"),ev(0,1,1),1))

  assert([0,0], evalParamFrame(parseExpression("[0,2]t1{per:(1,2)}"),ev(0,0,1),0))
  assert([0,2], evalParamFrame(parseExpression("[0,2]t1{per:(1,2)}"),ev(0,1,1),1))

  assert(0.8534541970584542, evalParamFrame(parseExpression("[0:1]r{per:1,seed:0}"),ev(0,0,1),0))
  assert(0.24364092224277556, evalParamFrame(parseExpression("[0:1]r{per:1,seed:10}"),ev(0,0,1),0))
  assert([0.8534541970584542, 0.24364092224277556], evalParamFrame(parseExpression("[0:1]r{per:1,seed:(0,10)}"),ev(0,0,1),0))

  assert(0.1989616905192142, evalParamFrame(parseExpression("[0:1]n{per:2,seed:0}"),ev(0,1,1),1))
  assert(0.31159096606000625, evalParamFrame(parseExpression("[0:1]n{per:2,seed:10}"),ev(0,1,1),1))
  assert([0.1989616905192142, 0.31159096606000625], evalParamFrame(parseExpression("[0:1]n{per:2,seed:(0,10)}"),ev(0,1,1),1))

  assert(64, evalParamFrame(parseExpression("2^3^2"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("{a:{b:2}}.a.b"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("{a:2} . a"),ev(0,0,0),0))
  assert([1,2], evalParamFrame(parseExpression('(1,2,3,4).(0,1)'),ev(0,0),0))

  p = parseExpression('(1,2,3).( 0, [1,2]t1 )')
  assert([1,2], evalParamFrame(p,ev(0,0),0))
  assert([1,3], evalParamFrame(p,ev(1,1),1))

  p = parseExpression('([0:1]l4@f){per:1}')
  assert(0, evalParamFrame(p,ev(0,0),0))
  assert(0, evalParamFrame(p,ev(1,1),1))

  assert(2, evalParamFrame(parseExpression("max{2}"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("2 .max"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("(1,2).max"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("max{1,2}"),ev(0,0,0),0))
  assert([1,2], evalParamFrame(parseExpression("max{(1,2)}"),ev(0,0,0),0))
  assert(1, evalParamFrame(parseExpression("(1,2).max{0}"),ev(0,0,0),0))
  assert({_state:{},value:'max'}, evalParamFrame(parseExpression("max"),ev(0,0,0),0))

  assert({value:{a:1},b:2}, evalParamFrame(parseExpression("{{a:1},b:2}"),ev(0,0,0),0))
  assert({value:440,q:50}, evalParamFrame(parseExpression("{max{440},q:50}"),ev(0,0,0),0))

  assert({value:4,rotate:1}, evalParamFrame(parseExpression("{4,rotate:1}"),ev(0,0,0),0))
  assert({value:4,rotate:2}, evalParamFrame(parseExpression("{4,rotate:max{1,2}}"),ev(0,0,0),0))

  assert(1, evalParamFrame(parseExpression("1?2"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("this.foo?2"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("this.foo ? 2"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("{a:this.foo}.a?2"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("{}.foo?2"),ev(0,0,0),0))

  assert(100, evalParamFrame(parseExpression("[0:1]l4{per:4,0:100}@f"),ev(0,0,4),0))
  assert(1/4, evalParamFrame(parseExpression("[0:1]l4{per:4,0:100}@f"),ev(0,0,4),1))

  p = parseExpression("[1:2]e")
  assert(1, evalParamFrame(p,ev(0,0,1),0))
  assert(3/2, evalParamFrame(p,ev(0,0,1),1/2))

  p = parseExpression("[1:2]e@e")
  assert(1, evalParamFrame(p,ev(0,0,1),0))
  assert(1, evalParamFrame(p,ev(0,0,1),1/2))

  p = parseExpression("([1:2]e)@e")
  assert(1, evalParamFrame(p,ev(0,0,1),0))
  assert(1, evalParamFrame(p,ev(0,0,1),1/2))

  console.log('Parse expression tests complete')
  }

  return parseExpression
})
