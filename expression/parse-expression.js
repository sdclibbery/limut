'use strict';
define(function(require) {
  let number = require('expression/parse-number')
  let parseMap = require('expression/parse-map')
  let parseArray = require('expression/parse-array')
  let eatWhitespace = require('expression/eat-whitespace')
  let operatorTree = require('expression/parse-operator')
  let {operators} = require('expression/operators')
  let {parseVar,varLookup} = require('expression/parse-var')
  let {hoistInterval,parseInterval} = require('expression/intervals')
  let addModifiers = require('expression/time-modifiers').addModifiers
  let {evalParamFrame,evalParamFrameWithInterval} = require('player/eval-param')
  let parseColour = require('expression/parse-colour')
  let parseString = require('expression/parse-string')
  let parsePiecewise = require('expression/parse-piecewise')
  let parseUnits = require('expression/parse-units')
  let vars = require('vars')

  let expression = (state) => {
    let result
    let operatorList = []
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === '') { break }
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') { state.idx += 1; continue }
      // piecewise
      if (char == '[') {
        result = parsePiecewise(state)
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
          result.interval = parseInterval(state) || hoistInterval(undefined, vs)
        } else {
          result = vs
        }
        continue
      }
      // map (object) or user defined function
      if (char == '{') {
        let map = parseMap(state)
        eatWhitespace(state)
        if (state.str.charAt(state.idx) === '-' && state.str.charAt(state.idx+1) === '>') { // user defined function
          state.idx+=2
          eatWhitespace(state)
          let oldArgs = state.userFunctionArgs
          state.userFunctionArgs = {}
          for (let k in map) { state.userFunctionArgs[map[k]()] = 0 }
          let body = state.expression(state)
          state.userFunctionArgs = oldArgs
          let userDefinedFunctionWrapper = (e,b,er,args) => {
            let oldArgs = vars.__functionArgs
            vars.__functionArgs = args // Yuck; set function args into a global var for access later
            let r = evalParamFrame(body,e,b)
            vars.__functionArgs = oldArgs
            return r
          }
          result = userDefinedFunctionWrapper
          result.isVarFunction = true
          result.isNormalCallFunction = true
          result.dontEvalArgs = true
          result.interval = parseInterval(state) || body.interval
          continue
        }
        result = addModifiers(map, parseMap(state)) // A map can still have modifiers
        parseInterval(state) // Ignore
        continue
      }
      // operator
      if (result !== undefined) {
        if (operators.hasOwnProperty(char)) { // Single char operators
          state.idx += 1
          operatorList.push(result)
          result = undefined
          operatorList.push(char)
          continue
        }
        let nextChar = state.str.charAt(state.idx+1)
        if (operators.hasOwnProperty(char+nextChar)) { // Two char operators
          state.idx += 2
          operatorList.push(result)
          result = undefined
          operatorList.push(char+nextChar)
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
        n = parseUnits(n, state)
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
      let interval = parseInterval(state)
      let v = varLookup(parsed, modifiers, state.context, interval, state.userFunctionArgs)
      if (v !== undefined) {
        result = addModifiers(v, modifiers)
        result.interval = hoistInterval(result.interval, typeof modifiers === 'object' ? Object.values(modifiers) : undefined)
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
      expression: expression, // Must make this available through state to avoid circular dependencies
      context: context,
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
  let assertApprox = (expected, actual, msg) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(3) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`+(msg?'\n'+msg:'')) }
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
  let assertIsSameEveryTime = (getter) => {
    let x = getter(0)
    for (let i=0; i<20; i++) {
        assert(x, getter(i/20), `Index: ${i} x: ${i/20}`)
    }
  }
  let assertIsDifferentEveryTime = (getter) => {
    let old = getter(0)
    for (let i=1; i<=20; i++) {
      let next = getter(i)
      assertNotEqual(old, next, `Index: ${i}`)
      old = next
    }
  }

  require('predefined-vars').apply(require('vars').all())
  let {evalParamFrame} = require('player/eval-param')
  let ev = (i,c,d) => {return{idx:i, count:c, dur:d, _time:c, endTime:c+d, countToTime:x=>x}}
  let e, v

  assert(undefined, parseExpression())
  assert(undefined, parseExpression(''))
  assert(1, parseExpression('1'))
  assert(123, parseExpression('123'))
  assert(1.1, parseExpression('1.1'))
  assert(.123, parseExpression('.123'))
  assert(-1, parseExpression('-1'))
  assert(1e9, parseExpression('1e9'))
  
  assert(1, evalParamFrame(parseExpression('[1,2]'),ev(0),0))
  assert(2, evalParamFrame(parseExpression('[1,2]'),ev(1),0))
  assert(1, evalParamFrame(parseExpression('[1,2]'),ev(2),0))
  assert(1, evalParamFrame(parseExpression('[[1,2]]'),ev(0),0))
  assert(2, evalParamFrame(parseExpression('[[1,2]]'),ev(1),0))
  assert(1, evalParamFrame(parseExpression('[[1,2]]'),ev(2),0))
  assert(1, evalParamFrame(parseExpression('[1:3]'),ev(0),0))
  assert(3, evalParamFrame(parseExpression('[1:3]'),ev(1),0))

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
  assert(1, evalParamFrame(p,ev(0,0),0))
  assert([2,3], evalParamFrame(p,ev(1,1),1))

  p = parseExpression('[(1,2,3),4,(5,6)]')
  assert([1,2,3], evalParamFrame(p,ev(0,0),0))
  assert(4, evalParamFrame(p,ev(1,1),1))
  assert([5,6], evalParamFrame(p,ev(2,2),2))
  assert([1,2,3], evalParamFrame(p,ev(3,3),3))

  assert(3, parseExpression('1+2'))
  assert(6, parseExpression('1+2+3'))

  p = parseExpression('[1,2]T1@f')
  assert(1, evalParamFrame(p,ev(0),0))
  assert(1, evalParamFrame(p,ev(0),1/2))
  assert(2, evalParamFrame(p,ev(0),1))
  assert(2, evalParamFrame(p,ev(0),3/2))
  assert(1, evalParamFrame(p,ev(0),2))

  p = parseExpression('[1,2]T@f')
  assert(1, evalParamFrame(p,ev(0),0))
  assert(1, evalParamFrame(p,ev(0),3.9))
  assert(2, evalParamFrame(p,ev(0),4))

  p = parseExpression('[1,2,3]t[1,2]@f')
  assert(1, evalParamFrame(p,ev(0),0))
  assert(2, evalParamFrame(p,ev(0),1))
  assert(2, evalParamFrame(p,ev(0),2))
  assert(3, evalParamFrame(p,ev(0),3))
  assert(1, evalParamFrame(p,ev(0),4))

  p = parseExpression('[0:2]t1')
  assert(0, evalParamFrame(p,ev(0,0),0))
  assert(1, evalParamFrame(p,ev(1,1),1))
  assert(2, evalParamFrame(p,ev(2,2),2))
  assert(0, evalParamFrame(p,ev(3,3),3))

  p = parseExpression('[-1:1]t1')
  assert(-1, evalParamFrame(p,ev(0,0),0))
  assert(0, evalParamFrame(p,ev(1,1),1))
  assert(1, evalParamFrame(p,ev(2,2),2))
  assert(-1, evalParamFrame(p,ev(3,3),3))

  p = parseExpression('[0:[1,2]]t1')
  assert(0, evalParamFrame(p,ev(0,0),0))
  assert(1, evalParamFrame(p,ev(1,1),1))
  assert(0, evalParamFrame(p,ev(2,2),2))
  assert(0, evalParamFrame(p,ev(3,3),3))
  assert(0, evalParamFrame(p,ev(4,4),4))
  assert(2, evalParamFrame(p,ev(5,5),5))
  assert(0, evalParamFrame(p,ev(6,6),6))

  p = parseExpression('[0:[1,2]]t[1,2]')
  assert(0, evalParamFrame(p,ev(0,0),0))
  assert(1, evalParamFrame(p,ev(1,1),1))
  assert(1, evalParamFrame(p,ev(2,2),2))
  assert(2, evalParamFrame(p,ev(3,3),3))
  assert(1, evalParamFrame(p,ev(4,4),4))
  assert(1, evalParamFrame(p,ev(5,5),5))
  assert(0, evalParamFrame(p,ev(6,6),6))
  assert(2, evalParamFrame(p,ev(7,7),7))
  assert(1, evalParamFrame(p,ev(8,8),8))

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
  assert(0, evalParamFrame(p,ev(0,0),0))
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
  assert(4, evalParamFrame(p,ev(0),0))
  assert(6, evalParamFrame(p,ev(1),1))
  assert(4, evalParamFrame(p,ev(2),2))

  p = parseExpression(' [ 1 , 2 ] + 3 ')
  assert(4, evalParamFrame(p,ev(0),0))
  assert(5, evalParamFrame(p,ev(1),1))
  assert(4, evalParamFrame(p,ev(2),2))

  p = parseExpression('1+[2,3]')
  assert(3, evalParamFrame(p,ev(0),0))
  assert(4, evalParamFrame(p,ev(1),1))
  assert(3, evalParamFrame(p,ev(2),2))

  p = parseExpression('[1,2,3]+[4,5] ')
  assert(5, evalParamFrame(p,ev(0),0))
  assert(7, evalParamFrame(p,ev(1),1))
  assert(7, evalParamFrame(p,ev(2),2))
  assert(6, evalParamFrame(p,ev(3),3))

  p = parseExpression('[1,2]t1@f+3 ')
  assert(4, evalParamFrame(p,ev(0),0))
  assert(5, evalParamFrame(p,ev(0),1))
  assert(4, evalParamFrame(p,ev(0),2))

  p = parseExpression('3+[1,2]t1@f ')
  assert(4, evalParamFrame(p,ev(0),0))
  assert(5, evalParamFrame(p,ev(0),1))
  assert(4, evalParamFrame(p,ev(0),2))

  p = parseExpression('[1,2]t1@f+[3,4]t1@f')
  assert(4, evalParamFrame(p,ev(0),0))
  assert(6, evalParamFrame(p,ev(0),1))
  assert(4, evalParamFrame(p,ev(0),2))

  p = parseExpression('2+foo+2')
  vars.foo = parseExpression('[1,2]t1@f')
  assert(5, evalParamFrame(p,ev(0),0))
  assert(6, evalParamFrame(p,ev(0),1))
  assert(5, evalParamFrame(p,ev(0),2))
  vars.foo = parseExpression('5')
  assert(9, evalParamFrame(p,ev(0),3))
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
  assert([4,5], evalParamFrame(p,ev(0),0))
  assert([5,6], evalParamFrame(p,ev(0),1))
  assert([4,5], evalParamFrame(p,ev(0),2))

  p = parseExpression('foo + (0,2)')
  vars.foo = parseExpression('[1,2]t1@f')
  assert([1,3], evalParamFrame(p,ev(0),0))
  assert([2,4], evalParamFrame(p,ev(0),1))
  delete vars.foo

  p = parseExpression('foo + (0,2)')
  vars.foo = parseExpression('[1,2]t1@f')
  e = ev(0)
  assert([1,3], evalParamFrame(p,e,0))
  assert([2,4], evalParamFrame(p,e,1))
  delete vars.foo

  p = parseExpression('foo + (0,2)')
  vars.foo = parseExpression('[1,2]t1@e')
  assert([1,3], evalParamFrame(p,ev(0),0))
  assert([1,3], evalParamFrame(p,ev(0),1))
  delete vars.foo

  p = parseExpression('(foo,[3,4]t1@f)')
  vars.foo = parseExpression('1')
  assert([1,3], evalParamFrame(p,ev(0),0))
  assert([1,4], evalParamFrame(p,ev(0),1))
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
  e = ev(0,0,1)
  assert(1, evalParamFrame(p,e,0,evalParamFrame))
  assert(1, evalParamFrame(p,e,0.5,evalParamFrame))
  e = ev(1,1,1)
  assert(2, evalParamFrame(p,e,1,evalParamFrame))
  assert(5, evalParamFrame(p,e,1.5,evalParamFrame))
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
    let v = evalParamFrame(p,ev(0),0)
    assertOneOf([1,5,7], v)
    assertInteger(v, 'v:'+v)
  }

  p = parseExpression('[0:9]r')
  for (let i = 0; i<20; i+=1) {
    assertIn(0, 9, evalParamFrame(p,ev(0),0))
    assertNotInteger(evalParamFrame(p,ev(0),0))
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
  assert(1, evalParamFrame(p,ev(0),0))
  assert(2, evalParamFrame(p,ev(1/2),1/2))
  assert(1, evalParamFrame(p,ev(1),1))

  p = parseExpression('[1,2]T1/2@f')
  assert(1, evalParamFrame(p,ev(0),0))
  assert(2, evalParamFrame(p,ev(1/2),1/2))
  assert(1, evalParamFrame(p,ev(1),1))

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
  assert(1, evalParamFrame(p,ev(0),0))
  assert(2, evalParamFrame(p,ev(1),1))
  assert(1, evalParamFrame(p,ev(2),2))

  p = parseExpression("[0,1]t1/4@f")
  assert(0, evalParamFrame(p,ev(0),0/4))
  assert(1, evalParamFrame(p,ev(0),1/4))
  assert(0, evalParamFrame(p,ev(0),2/4))

  p = parseExpression("[1,2]t2@f*2")
  assert(2, evalParamFrame(p,ev(0),0))
  assert(2, evalParamFrame(p,ev(1),1))
  assert(4, evalParamFrame(p,ev(2),2))
  assert(4, evalParamFrame(p,ev(3),3))
  assert(2, evalParamFrame(p,ev(4),4))

  assert('http://a.com/Bc.mp3', parseExpression("'http://a.com/Bc.mp3'"))

  assert(2, parseExpression("[1]+1")(ev(0),0,evalParamFrame))

  p = parseExpression("[#f00f,#00ff]t1@f")
  assert({r:1,g:0,b:0,a:1}, evalParamFrame(p,ev(0),0))
  assert({r:0,g:0,b:1,a:1}, evalParamFrame(p,ev(1),1))

  p = parseExpression('[1,2]r1@f')
  let v0 = evalParamFrame(p,ev(0,0),0)
  for (let i = 0; i<20; i+=1) { assert(v0, evalParamFrame(p,ev(0),0)) }
  let v1 = evalParamFrame(p,ev(1),1)
  for (let i = 0; i<20; i+=1) { assert(v1, evalParamFrame(p,ev(1),1)) }

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

  assert(undefined, parseExpression("(0,1)").interval)
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
  assert(undefined, p.interval)
  delete vars.foo

  p = parseExpression('foo@e')
  vars.foo = parseExpression('0')
  assert('event', p.interval)
  delete vars.foo

  p = parseExpression('foo@f')
  vars.foo = parseExpression('0')
  assert('frame', p.interval)
  delete vars.foo

  assertApprox(0, evalParamFrame(parseExpression("[0,1]l0.1@f"),ev(0,0),0))
  assertApprox(1, evalParamFrame(parseExpression("[0,1]l0.1@f"),ev(0,0),0.1))
  assertApprox(0, evalParamFrame(parseExpression("[0,1]l0.1@f"),ev(0,0),1))

  assert(0, evalParamFrame(parseExpression("[0,1]t1@e"),ev(0,0),1))
  assert(1, evalParamFrame(parseExpression("[0,1]t1@f"),ev(0,0),1))
  assert(0, evalParamFrame(parseExpression("[0,1]l1@e"),ev(0,0),1))
  assert(1, evalParamFrame(parseExpression("[0,1]l1@f"),ev(0,0),1))
  assert(0, evalParamFrame(parseExpression("[0,1]s1@e"),ev(0,0),1))
  assert(1, evalParamFrame(parseExpression("[0,1]s1@f"),ev(0,0),1))

  let r
  p = parseExpression("[0:1]r1")
  r = evalParamFrame(p,ev(0,0),0)
  for (let i=0; i<20; i++) { assert(r, evalParamFrame(p,ev(0,0),i/20)) }
  assertNotEqual(r, evalParamFrame(p,ev(1,1),1))

  p = parseExpression("[0:1]r1@e")
  r = evalParamFrame(p,ev(0,0),0)
  for (let i=0; i<20; i++) { assert(r, evalParamFrame(p,ev(0,0),i/20)) }
  assertNotEqual(r, evalParamFrame(p,ev(1,1),1))

  p = parseExpression("[0:1]r1@f")
  r = evalParamFrame(p,ev(0,0),0)
  for (let i=0; i<20; i++) { assert(r, evalParamFrame(p,ev(0,0),i/20)) }
  assertNotEqual(r, evalParamFrame(p,ev(0,0),1))

  p = parseExpression("[0:1]e")
  e = { idx:0, count:7, countToTime:b=>b, dur:1 }
  assert(0, evalParamFrame(p,e,6))
  assert(0, evalParamFrame(p,e,7))
  assert(0.5, evalParamFrame(p,e,7.5))
  assertApprox(1, evalParamFrame(p,e,8))
  assertApprox(1, evalParamFrame(p,e,9))

  p = parseExpression("[0:1]e2")
  e = { idx:0, count:7, countToTime:b=>b, dur:1 }
  assert(0, evalParamFrame(p,e,6))
  assert(0, evalParamFrame(p,e,7))
  assert(0.5, evalParamFrame(p,e,8))
  assert(1, evalParamFrame(p,e,9))
  assert(1, evalParamFrame(p,e,10))

  p = parseExpression("[0,1,0]e")
  e = { idx:0, count:7, countToTime:b=>b, dur:1 }
  assert(0, evalParamFrame(p,e,6))
  assert(0, evalParamFrame(p,e,7))
  assert(1, evalParamFrame(p,e,7.5))
  assertApprox(0, evalParamFrame(p,e,8))
  assertApprox(0, evalParamFrame(p,e,9))

  p = parseExpression("[0:1]e")
  e = { idx:0, count:7, countToTime:b=>b, dur:2 }
  assert(0, evalParamFrame(p,e,7))
  assert(0.5, evalParamFrame(p,e,8))
  assertApprox(1, evalParamFrame(p,e,9))

  p = parseExpression("[0,1,0]e")
  e = { idx:0, count:1, countToTime:b=>b, dur:2 }
  assert(0, evalParamFrame(p,e,1))
  assert(1, evalParamFrame(p,e,2))
  assertApprox(0, evalParamFrame(p,e,3))

  p = parseExpression("[1]e")
  e = { idx:0, count:1, countToTime:b=>b, dur:1 }
  assert(1, evalParamFrame(p,e,0))
  assert(1, evalParamFrame(p,e,1))
  assert(1, evalParamFrame(p,e,2))
  assert(1, evalParamFrame(p,e,3))

  p = parseExpression("[]e")
  e = { idx:0, count:1, countToTime:b=>b, dur:1 }
  assert(0, evalParamFrame(p,e,0))
  assert(0, evalParamFrame(p,e,1))
  assert(0, evalParamFrame(p,e,2))
  assert(0, evalParamFrame(p,e,3))

  p = parseExpression("[0:1]e1/2")
  e = { idx:0, count:7, countToTime:b=>b, dur:1 }
  assert(0, evalParamFrame(p,e,6))
  assert(0, evalParamFrame(p,e,7))
  assert(0.5, evalParamFrame(p,e,7.25))
  assert(1, evalParamFrame(p,e,7.5))
  assert(1, evalParamFrame(p,e,8))
  assert(1, evalParamFrame(p,e,9))

  p = parseExpression("[0,1,2]e[2,1]")
  e = { idx:0, count:0, countToTime:b=>b, dur:3 }
  assert(0, evalParamFrame(p,e,0))
  assert(0.5, evalParamFrame(p,e,1))
  assert(1, evalParamFrame(p,e,2))
  assert(2, evalParamFrame(p,e,3))
  assert(2, evalParamFrame(p,e,4))

  p = parseExpression('[(0,2),(1,3)]e')
  e = { idx:0, count:0, countToTime:b=>b, dur:1 }
  assert([0,2], evalParamFrame(p,e,0,evalParamFrame))
  assert([0.5,2.5], evalParamFrame(p,e,1/2,evalParamFrame))
  assert([1,3], evalParamFrame(p,e,2,evalParamFrame))

  p = parseExpression("[0:1]e")
  let e1 = { idx:0, count:7, countToTime:b=>b, dur:63 }
  let e2 = { idx:0, count:7, countToTime:b=>b, dur:1 }
  assertApprox(0.015873015873015872, evalParamFrame(p,e1,8))
  assertApprox(1, evalParamFrame(p,e2,8))

  assert(1, parseExpression("[1,0]t1")(ev(0,0),0,evalParamFrame))
  assert(0, parseExpression("[1,0]t1")(ev(1,1),1,evalParamFrame))
  assert(1, parseExpression("[1,0]l1")(ev(0,0),0,evalParamFrame))
  assert(0, parseExpression("[1,0]l1")(ev(1,1),1,evalParamFrame))

  p = parseExpression("[1000:100]e")
  e = { idx:0, count:7, countToTime:b=>b, dur:1 }
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
  e = { idx:0, count:7, countToTime:b=>b, dur:1 }
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
  assert(5, evalParamFrame(parseExpression('foo'),ev(0,0),0))
  delete vars.foo

  vars.foo = () => 5
  vars.foo.isVarFunction = true
  assert(5, evalParamFrame(parseExpression('foo{}'),ev(0,0),0))
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
  p = parseExpression("[red,green]l1")
  assert({g:1}, evalParamFrame(p,ev(1,1),1))
  assert({r:1/2,g:1/2}, evalParamFrame(p,ev(1,1/2),1/2))
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
  e = { idx:0, count:0, countToTime:b=>b, dur:1 }
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

  p = parseExpression('[0:1]r{seed:[1,100],per:1}')
  assert(0.3853306171949953, evalParamFrame(p,ev(0,0),0))
  assert(0.19610000611282885, evalParamFrame(p,ev(1,1),1))
  assert(0.3853306171949953, evalParamFrame(p,ev(2,2),2))
  assert(0.19610000611282885, evalParamFrame(p,ev(3,3),3))

  p = parseExpression('rand')
  assertNumber(evalParamFrame(p,ev(0,0),0))

  p = parseExpression('rand{seed:[1,100]t1,per:1}')
  assert(0.3853306171949953, evalParamFrame(p,ev(0,0),0))
  assert(0.19610000611282885, evalParamFrame(p,ev(1,1),1))
  assert(0.3853306171949953, evalParamFrame(p,ev(2,2),2))
  assert(0.19610000611282885, evalParamFrame(p,ev(3,3),3))

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

  assert('foo', evalParamFrame(parseExpression('foo'),ev(0,0),0))
  assert('max', evalParamFrame(parseExpression('max'),ev(0,0),0))
  assert('min', evalParamFrame(parseExpression('min'),ev(0,0),0))

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

  assert([0,0], evalParamFrame(parseExpression("[0,2,3]t1{per:(1,2)}"),ev(0,0,1),0))
  assert([0,2], evalParamFrame(parseExpression("[0,2,3]t1{per:(1,2)}"),ev(0,1,1),1))
  assert([0,0], evalParamFrame(parseExpression("[0,2,3]t1{per:(1,2)}"),ev(0,2,1),2))

  assert(0.8534541970584542, evalParamFrame(parseExpression("[0:1]r{per:1,seed:0}"),ev(0,0,1),0))
  assert(0.24364092224277556, evalParamFrame(parseExpression("[0:1]r{per:1,seed:10}"),ev(0,0,1),0))
  assert([0.8534541970584542, 0.24364092224277556], evalParamFrame(parseExpression("[0:1]r{per:1,seed:(0,10)}"),ev(0,0,1),0))

  assert(0.1989616905192142, evalParamFrame(parseExpression("[0:1]n{per:2,seed:0}"),ev(0,1,1),1))
  assert(0.31159096606000625, evalParamFrame(parseExpression("[0:1]n{per:2,seed:10}"),ev(0,1,1),1))
  assert([0.1989616905192142, 0.31159096606000625], evalParamFrame(parseExpression("[0:1]n{per:2,seed:(0,10)}"),ev(0,1,1),1))

  p = parseExpression('([0:1]l4@f){per:1}')
  assert(0, evalParamFrame(p,ev(0,0),0))
  assert(0, evalParamFrame(p,ev(1,1),1))
  assert(0, evalParamFrame(p,ev(2,2),2))

  assert(100, evalParamFrame(parseExpression("[0:1]l4{per:4,0:100}@f"),ev(0,0,4),0))
  assert(1/4, evalParamFrame(parseExpression("[0:1]l4{per:4,0:100}@f"),ev(0,0,4),1))

  assert(64, evalParamFrame(parseExpression("2^3^2"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("{a:{b:2}}.a.b"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("{a:2} . a"),ev(0,0,0),0))
  assert([1,2], evalParamFrame(parseExpression('(1,2,3,4).(0,1)'),ev(0,0),0))

  p = parseExpression('(1,2,3).( 0, [1,2]t1 )')
  assert([1,2], evalParamFrame(p,ev(0,0),0))
  assert([1,3], evalParamFrame(p,ev(1,1),1))

  p = parseExpression('[0:1]l4{per:1}@f')
  assert(0, evalParamFrame(p,ev(0,0),0))
  assert(0, evalParamFrame(p,ev(1,1),1))
  assert(0, evalParamFrame(p,ev(2,2),2))

  assert(2, evalParamFrame(parseExpression("max{2}"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("2 .max"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("(1,2).max"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("max{1,2}"),ev(0,0,0),0))
  assert([1,2], evalParamFrame(parseExpression("max{(1,2)}"),ev(0,0,0),0))

  assert({value:{a:1},b:2}, evalParamFrame(parseExpression("{{a:1},b:2}"),ev(0,0,0),0))
  assert({value:440,q:50}, evalParamFrame(parseExpression("{max{440},q:50}"),ev(0,0,0),0))

  assert({value:4,rotate:1}, evalParamFrame(parseExpression("{4,rotate:1}"),ev(0,0,0),0))
  assert({value:4,rotate:2}, evalParamFrame(parseExpression("{4,rotate:max{1,2}}"),ev(0,0,0),0))

  assert(1, evalParamFrame(parseExpression("1?2"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("this.foo?2"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("this.foo ? 2"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("{a:this.foo}.a?2"),ev(0,0,0),0))
  assert(2, evalParamFrame(parseExpression("{}.foo?2"),ev(0,0,0),0))

  vars._time = (args,e,b)=>b
  vars._time.isVarFunction = true
  assert(1, evalParamFrame(parseExpression("_time"),ev(0,0,4),1))
  assert(2, evalParamFrame(parseExpression("[0:4,4:4]{2}"),ev(0,0,4),0))
  assert(2, evalParamFrame(parseExpression("[0:4,4:4]{_time}"),ev(2,2,4),2))
  assert(0, evalParamFrame(parseExpression("[0:4,4:4]{_time,per:1}"),ev(2,2,4),2))
  assert(0, evalParamFrame(parseExpression("[0:4,4:4]{_time{per:1}}"),ev(2,2,4),2))
  assert(0, evalParamFrame(parseExpression("[0:4]l4{per:1}@f"),ev(2,2,4),2))
  delete vars._time

  p = parseExpression("[1:2]e")
  assert(1, evalParamFrame(p,ev(0,0,1),0))
  assert(3/2, evalParamFrame(p,ev(0,0,1),1/2))

  p = parseExpression("[1:2]e@e")
  assert(1, evalParamFrame(p,ev(0,0,1),0))
  assert(1, evalParamFrame(p,ev(0,0,1),1/2))

  p = parseExpression("([1:2]e)@e")
  assert(1, evalParamFrame(p,ev(0,0,1),0))
  assert(1, evalParamFrame(p,ev(0,0,1),1/2))

  let evt = (t,c,d) => {return{idx:0,count:c||0,dur:d||1,_time:t||1,voice:0,beat:{duration:(t||1)/(c||1)}}}
  assertIsDifferentEveryTime(() => evalParamFrame(parseExpression("rand"), ev(), 0))

  p = parseExpression("rand{seed:1}")
  assertApprox(0.385, evalParamFrame(p, evt(), 0))
  assertIsSameEveryTime(() => evalParamFrame(p, evt(), 0))
  assertIsDifferentEveryTime((i) => evalParamFrame(p, evt(), i/1200))

  p = parseExpression("rand{seed:2}")
  assertApprox(0.385, evalParamFrame(p, evt(), 1))

  p = parseExpression("rand{step:1}")
  e = evt()
  assertIsSameEveryTime((x) => evalParamFrame(p, e, 0+x))
  assertIsSameEveryTime((x) => evalParamFrame(p, e, 1+x))
  assertIsSameEveryTime((x) => evalParamFrame(p, e, 2+x))
  assertIsDifferentEveryTime((i) => evalParamFrame(p, e, i))

  p = parseExpression("rand@e")
  e = evt()
  assertIsSameEveryTime((x) => evalParamFrame(p, e, 0+x))
  assertIsDifferentEveryTime((i) => evalParamFrame(p, evt(i,i,1), i))

  p = parseExpression("rand{step:2}@e")
  e = evt()
  assertIsSameEveryTime((x) => evalParamFrame(p, e, 0+x))
  assertIsDifferentEveryTime((i) => evalParamFrame(p, evt(i*2,i*2,1), i*2))

  p = parseExpression("rand{seed:1}@e")
  assertApprox(0.385, evalParamFrame(p, evt(), 0))
  assertIsSameEveryTime((x) => evalParamFrame(p, evt(0,0,1), 0+x))
  assertIsDifferentEveryTime((i) => evalParamFrame(p, evt(i*2,i*2,1), i*2))

  p = parseExpression("rand{per:1}")
  e = evt()
  assertIsDifferentEveryTime((i) => evalParamFrame(p, e, i/1200))
  assert(evalParamFrame(p, e, 0), evalParamFrame(p, e, 1))
  assert(evalParamFrame(p, e, 1), evalParamFrame(p, e, 2))

  e = ev(0,0)
  p = parseExpression("[]r")
  r = evalParamFrame(p,e,0)
  assert(r, evalParamFrame(p,e,Math.random()))
  assertNotEqual(r, evalParamFrame(p,ev(0,0),0)) // different values for new events

  p = parseExpression("[]r2")
  assertIsSameEveryTime((x) => evalParamFrame(p, evt(0,0,1), 0+x*2))
  assertIsDifferentEveryTime((i) => evalParamFrame(p, evt(i*2,i*2,1), i*2))
  
  assert(1/2, evalParamFrame(parseExpression("[0:/1,1]{1/2}"), evt(), 0))
  assert(1/2, evalParamFrame(parseExpression("[0:/,1]{1/2}"), evt(), 0))
  assert(1/2, evalParamFrame(parseExpression("[0:/4,1]{2}"), evt(), 0))
  assert(1/2, evalParamFrame(parseExpression(" [ 0 :/ 4, 1 ] { 2 } "), evt(), 0))

  p = parseExpression("[1:/4,2]{2}")
  assert(3/2, evalParamFrame(p, evt(), 0))
  assertIsSameEveryTime((x) => evalParamFrame(p, evt(), 0+x*2))

  p = parseExpression("[ (1,2).1 ]{0}")
  assert(2, evalParamFrame(p, evt(0,0,1), 0))
  assert(2, evalParamFrame(p, evt(1,1,1), 1))

  p = parseExpression("[ [1,2]t1 ]{0}")
  assert(1, evalParamFrame(p, evt(0,0,1), 0))
  assert(2, evalParamFrame(p, evt(1,1,1), 1))
  assert(1, evalParamFrame(p, evt(2,2,1), 2))

  p = parseExpression("[ [1,2]t1/4@f ]{0}")
  assert(1, evalParamFrame(p, evt(0,0,1), 0))
  assert(2, evalParamFrame(p, evt(0,0,1), 1/4))
  assert(1, evalParamFrame(p, evt(0,0,1), 1/2))
  assert(1, evalParamFrame(p, evt(1,1,1), 1))
  
  p = parseExpression("[2,3]{ (0,1).3 }")
  assert(3, evalParamFrame(p, evt(0,0,1), 0))
  assert(3, evalParamFrame(p, evt(1,1,1), 1))
  
  p = parseExpression("[2,3]{ [0,1]t1 }")
  assert(2, evalParamFrame(p, evt(0,0,1), 0))
  assert(3, evalParamFrame(p, evt(1,1,1), 1))
  assert(2, evalParamFrame(p, evt(2,2,1), 2))
  
  p = parseExpression("[2,3]{ [0,1]t1/4@f }")
  assert(2, evalParamFrame(p, evt(0,0,1), 0))
  assert(3, evalParamFrame(p, evt(0,0,1), 1/4))
  assert(2, evalParamFrame(p, evt(0,0,1), 1/2))
  assert(2, evalParamFrame(p, evt(1,1,1), 1))
  
  p = parseExpression("[0:/3,3:\\1]t")
  assert(0, evalParamFrame(p, evt(0,0,1), 0))
  assert(1, evalParamFrame(p, evt(1,1,1), 1))
  assert(2, evalParamFrame(p, evt(2,2,1), 2))
  assert(3, evalParamFrame(p, evt(3,3,1), 3))
  assert(0, evalParamFrame(p, evt(4,4,1), 4))
  
  p = parseExpression("[0:!1,1:!1]l@f")
  assert(0, evalParamFrame(p, evt(0,0,2), 0))
  assertApprox(0.982, evalParamFrame(p, evt(0,0,2), 1/2))
  assert(1, evalParamFrame(p, evt(0,0,2), 1))
  assertApprox(0.018, evalParamFrame(p, evt(0,0,2), 3/2))

  p = parseExpression("[0:3,3:1]l")
  assert(0, evalParamFrame(p, evt(0,0,1), 0))
  assert(1, evalParamFrame(p, evt(1,1,1), 1))
  assert(2, evalParamFrame(p, evt(2,2,1), 2))
  assert(3, evalParamFrame(p, evt(3,3,1), 3))
  assert(0, evalParamFrame(p, evt(4,4,1), 4))

  p = parseExpression("[0:/3,3:1]s")
  assert(0, evalParamFrame(p, evt(0,0,1), 0))
  assert(1, evalParamFrame(p, evt(1,1,1), 1))
  assert(2, evalParamFrame(p, evt(2,2,1), 2))
  assert(3, evalParamFrame(p, evt(3,3,1), 3))
  assert(0, evalParamFrame(p, evt(4,4,1), 4))

  p = parseExpression("[0:3,3]e")
  e = ev(0,0,4)
  assert(0, evalParamFrame(p, e, 0))
  assert(1, evalParamFrame(p, e, 1))
  assert(2, evalParamFrame(p, e, 2))
  assert(3, evalParamFrame(p, e, 3))
  assert(3, evalParamFrame(p, e, 4))

  p = parseExpression("[0:0,0:0,0:0,0:0,0:0,1:1]r")
  assertNotEqual(0, evalParamFrame(p, ev(0,0,1), 0))

  p = parseExpression("[(),2]t1")
  assert([], evalParamFrame(p, ev(0,0,1), 0))
  assert(2, evalParamFrame(p, ev(1,1,1), 1))

  p = parseExpression("(1,2).time")
  assert(1, evalParamFrame(p, ev(0,0,1), 0))
  assert(1, evalParamFrame(p, ev(0,0,1), 0.1))
  assert(2, evalParamFrame(p, ev(1,1,1), 1))
  assert(2, evalParamFrame(p, ev(1,1,1), 1.1))
  assert(1, evalParamFrame(p, ev(2,2,1), 2))

  p = parseExpression("(1,2).time{per:1}")
  assert(1, evalParamFrame(p, ev(0,0,1), 0))
  assert(1, evalParamFrame(p, ev(1,1,1), 1))
 
  p = parseExpression("(1,1).(rand*999)")
  assert(1, evalParamFrame(p, ev(0,0,1), 0))

  p = parseExpression("(1,2,3).rand")
  assertIn(1,3, evalParamFrame(p, ev(0,0,1), 0))

  p = parseExpression("(1,2,3,4).rand{seed:1}")
  assert(2, evalParamFrame(p, ev(0,0,1), 0))
  assert(4, evalParamFrame(p, ev(0,0,1), 1))
  assert(2, evalParamFrame(p, ev(0,0,1), 2))
  assert(1, evalParamFrame(p, ev(0,0,1), 3))

  p = parseExpression("rand{1,2,3}")
  assertIn(1,3, evalParamFrame(p, ev(0,0,1), 0))

  p = parseExpression("rand{1,2,3,4,seed:1}")
  assert(2, evalParamFrame(p, ev(0,0,1), 0))
  assert(4, evalParamFrame(p, ev(0,0,1), 1))
  assert(2, evalParamFrame(p, ev(0,0,1), 2))
  assert(1, evalParamFrame(p, ev(0,0,1), 3))

  p = parseExpression("rand{[2,3]t1/2@f}")
  assert(2, evalParamFrame(p, ev(0,0,1), 0))
  assert(3, evalParamFrame(p, ev(0,0,1), 1/2))
  assert(2, evalParamFrame(p, ev(0,0,1), 1))

  p = parseExpression("(1,2,3).(rand+1)")
  assert(2, evalParamFrame(p, ev(0,0,1), 0))

  p = parseExpression("({g:1}*p.foo.max).g") // player p does not exist, so this should give 0
  assert(0, evalParamFrame(p, ev(0,0,1), 0))

  p = parseExpression("({g:1}*0.max).g")
  assert(0, evalParamFrame(p, ev(0,0,1), 0))

  p = parseExpression("2*[0:/1,1:/4,0:3]e -1")
  assert(-1, evalParamFrame(p, ev(0,0,8), 0))
  assert(1, evalParamFrame(p, ev(0,0,8), 1))
  assert(0, evalParamFrame(p, ev(0,0,8), 3))
  assert(-1, evalParamFrame(p, ev(0,0,8), 5))
  assert(-1, evalParamFrame(p, ev(0,0,8), 7))

  assert({value:0,'#':1}, evalParamFrame(parseExpression("0#"),ev(0,0),0))
  assert({value:2,b:1,_units:'b'}, evalParamFrame(parseExpression("2b"),ev(0,0),0))
  assert({value:0.15,_units:'s'}, evalParamFrame(parseExpression("0.15s"),ev(0,0),0))
  assert({value:0.15,_units:'s'}, evalParamFrame(parseExpression("150ms"),ev(0,0),0))
  assert({value:150,_units:'hz'}, evalParamFrame(parseExpression("150hz"),ev(0,0),0))
  assert({value:150,_units:'hz'}, evalParamFrame(parseExpression("50hz*3"),ev(0,0),0))
  assert({value:150,_units:'hz'}, evalParamFrame(parseExpression("3*50hz"),ev(0,0),0))
  assert({value:150,_units:'hz'}, evalParamFrame(parseExpression("[150hz]r"),ev(0,0),0))
  assert({value:150,_units:'hz'}, evalParamFrame(parseExpression("3*[50hz]r"),ev(0,0),0))
  assert({value:150,_units:'hz'}, evalParamFrame(parseExpression("100+50hz"),ev(0,0),0))
  assert({value:150,_units:'hz'}, evalParamFrame(parseExpression("100hz+50"),ev(0,0),0))
  assert({value:150,_units:'hz'}, evalParamFrame(parseExpression("100hz+50hz"),ev(0,0),0))

  assert(1, evalParamFrame(parseExpression("[0:1,1:1]t@f"),ev(0,0),1.1))
  assert(0, evalParamFrame(parseExpression("[0:1s,1:1s]t@f"),ev(0,0),1.1))
  assert(0, evalParamFrame(parseExpression("[0:_0.1s,1:_0.1s,0]e"),ev(0,0),0.09*110/60))
  assert(1, evalParamFrame(parseExpression("[0:_0.1s,1:_0.1s,0]e"),ev(0,0),0.11*110/60))
  assert(1, evalParamFrame(parseExpression("[0:_0.1s,1:_0.1s,0]e"),ev(0,0),0.19*110/60))
  assert(0, evalParamFrame(parseExpression("[0:_0.1s,1:_0.1s,0]e"),ev(0,0),0.21*110/60))

  p = parseExpression("[{10}]t1 * [2]t1@f")
  e = ev(0,0,1)
  assert({value:20}, evalParamFrame(p, e, 0))
  assert({value:20}, evalParamFrame(p, e, 0)) // Should stay the same, obviously, but it didn't :-)

  let sInBeats = (t) => t*110/60
  p = parseExpression("[1,2]t100ms@f")
  assert(1, evalParamFrame(p, ev(0,0,1), sInBeats(0)))
  assert(2, evalParamFrame(p, ev(0,0,1), sInBeats(0.1)))
  assert(1, evalParamFrame(p, ev(0,0,1), sInBeats(0.2)))

  p = parseExpression("[1,2]t[100ms,200ms]@f")
  assert(1, evalParamFrame(p, ev(0,0,1), sInBeats(0)))
  assert(2, evalParamFrame(p, ev(0,0,1), sInBeats(0.1)))
  assert(2, evalParamFrame(p, ev(0,0,1), sInBeats(0.2)))
  assert(1, evalParamFrame(p, ev(0,0,1), sInBeats(0.3)))

  p = parseExpression("[0:1,1:0]l{step:300ms}@f")
  assert(0, evalParamFrame(p, ev(0,0,1), sInBeats(0)))
  assert(0, evalParamFrame(p, ev(0,0,1), sInBeats(0.1)))
  assert(0, evalParamFrame(p, ev(0,0,1), sInBeats(0.2)))
  assert(0.55, evalParamFrame(p, ev(0,0,1), sInBeats(0.3)))

  p = parseExpression("[0:1,1:0]l{per:300ms}@f")
  assert(0, evalParamFrame(p, ev(0,0,1), sInBeats(0)))
  assert(0.55/3, evalParamFrame(p, ev(0,0,1), sInBeats(0.1)))
  assert(0.55*2/3, evalParamFrame(p, ev(0,0,1), sInBeats(0.2)))
  assert(0, evalParamFrame(p, ev(0,0,1), sInBeats(0.3)))

  p = parseExpression("[1,2]{[0,1]t1@f}")
  e = ev(0,0,1)
  assert(1, evalParamFrame(p, e, 0))
  assert(2, evalParamFrame(p, e, 1))

  vars.foo = parseExpression('[0,1]t1@f')
  p = parseExpression("[1,2]{foo}")
  e = ev(0,0,1)
  assert(1, evalParamFrame(p, e, 0))
  assert(2, evalParamFrame(p, e, 1))
  delete vars.foo

  p = parseExpression("[1,2]{time}")
  e = ev(0,0,1)
  assert(1, evalParamFrame(p, e, 0))
  assert(2, evalParamFrame(p, e, 1))

  p = parseExpression("this.time")
  e = ev(0,0,1)
  assert(0, evalParamFrame(p, e, 0))
  assert(1, evalParamFrame(p, e, 1))
  assert(2, evalParamFrame(p, e, 2))

  p = parseExpression("[1,2]{this.time}")
  e = ev(0,0,1)
  assert(1, evalParamFrame(p, e, 0))
  assert(2, evalParamFrame(p, e, 1))
  assert(1, evalParamFrame(p, e, 2))

  p = parseExpression("[1:_[1,2],2:_1]{time}")
  assert(1, evalParamFrame(p, ev(0,0,1), 0))
  assert(1, evalParamFrame(p, ev(1,0,1), 1))
  assert(1, evalParamFrame(p, ev(2,0,1), 2))
  assert(1, evalParamFrame(p, ev(3,0,1), 3))
  assert(1, evalParamFrame(p, ev(4,0,1), 4))
  assert(2, evalParamFrame(p, ev(5,0,1), 5))
  assert(1, evalParamFrame(p, ev(6,0,1), 6))
  assert(1, evalParamFrame(p, ev(7,0,1), 7))

  p = parseExpression("[1:_[2,1],2:_1]{time}")
  assert(1, evalParamFrame(p, ev(0,0,1), 0))
  assert(2, evalParamFrame(p, ev(1,0,1), 1))
  assert(2, evalParamFrame(p, ev(2,0,1), 2))
  assert(2, evalParamFrame(p, ev(3,0,1), 3))
  assert(1, evalParamFrame(p, ev(4,0,1), 4))
  assert(2, evalParamFrame(p, ev(5,0,1), 5))
  assert(1, evalParamFrame(p, ev(6,0,1), 6))
  assert(2, evalParamFrame(p, ev(7,0,1), 7))

  p = parseExpression("[1:_[1,2],2:_1]{this.time}")
  assert(1, evalParamFrame(p, ev(0,4,1), 4+0))
  assert(1, evalParamFrame(p, ev(1,4,1), 4+1))
  assert(1, evalParamFrame(p, ev(2,4,1), 4+2))
  assert(1, evalParamFrame(p, ev(3,4,1), 4+3))
  assert(1, evalParamFrame(p, ev(4,4,1), 4+4))
  assert(2, evalParamFrame(p, ev(5,4,1), 4+5))
  assert(1, evalParamFrame(p, ev(6,4,1), 4+6))
  assert(1, evalParamFrame(p, ev(7,4,1), 4+7))

  p = parseExpression("[1:[1,2],2:1]t@f")
  assert(1, evalParamFrame(p, ev(0,0,1), 0))
  assert(1, evalParamFrame(p, ev(1,0,1), 1))
  assert(1, evalParamFrame(p, ev(2,0,1), 2))
  assert(1, evalParamFrame(p, ev(3,0,1), 3))
  assert(1, evalParamFrame(p, ev(4,0,1), 4))
  assert(2, evalParamFrame(p, ev(5,0,1), 5))
  assert(1, evalParamFrame(p, ev(6,0,1), 6))
  assert(1, evalParamFrame(p, ev(7,0,1), 7))

  p = parseExpression("[1:![500ms:100ms],0]e")
  assertApprox(1, evalParamFrame(p, ev(0,0,1), sInBeats(0)))
  assertApprox(0.202, evalParamFrame(p, ev(0,0,1), sInBeats(0.1)))
  assertApprox(1, evalParamFrame(p, ev(1,0,1), sInBeats(0)))
  assertApprox(0, evalParamFrame(p, ev(1,0,1), sInBeats(0.1)))

  p = parseExpression("[1:1,2:[0,1e10]]r")
  assert(1, evalParamFrame(p, ev(0,0,1), 0))
  assert(2, evalParamFrame(p, ev(1,0,1), 1))

  p = parseExpression("[1,0]es1")
  assert({"value":1,"_nextSegment":1,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 0))
  assert({"value":1/2,"_nextSegment":1,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 1/2))
  assert({"value":0,"_nextSegment":2,"_segmentPower":0}, evalParamFrame(p, ev(0,0,1), 1))

  p = parseExpression("2*[1,0]es1")
  assert({"value":2,"_nextSegment":1,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 0))
  assert({"value":1,"_nextSegment":1,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 1/2))
  assert({"value":0,"_nextSegment":2,"_segmentPower":0}, evalParamFrame(p, ev(0,0,1), 1))

  p = parseExpression("[2]t*[1,0]es1")
  assert({"value":2,"_nextSegment":1,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 0))
  assert({"value":1,"_nextSegment":1,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 1/2))
  assert({"value":0,"_nextSegment":2,"_segmentPower":0}, evalParamFrame(p, ev(0,0,1), 1))

  p = parseExpression("[2,0,4,0]es1/4*[1:_,0]es1/2")
  assert({"value":2,"_nextSegment":1/4,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 0))
  assert({"value":1,"_nextSegment":1/4,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 1/8))
  assert({"value":0,"_nextSegment":2/4,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 2/8))
  assert({"value":2,"_nextSegment":2/4,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 3/8))
  assert({"value":0,"_nextSegment":3/4,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 4/8))
  assert({"value":0,"_nextSegment":3/4,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 5/8))

  p = parseExpression("[0,1]es1+[1:!,0]es1")
  assert({"value":1,"_nextSegment":1,"_segmentPower":2}, evalParamFrame(p, ev(0,0,1), 0))
  assert({"value":0.5183156388887342,"_nextSegment":1,"_segmentPower":2}, evalParamFrame(p, ev(0,0,1), 1/2))
  assert({"value":1,"_nextSegment":2,"_segmentPower":0}, evalParamFrame(p, ev(0,0,1), 1))
  assert(1, evalParamFrame(p, ev(0,0,1), 2))

  p = parseExpression("[0,1]es1")
  assert({"value":0,"_nextSegment":1,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 0))
  assert({"value":1,"_nextSegment":2,"_segmentPower":0}, evalParamFrame(p, ev(0,0,1), 1))
  assert(1, evalParamFrame(p, ev(0,0,1), 2))

  p = parseExpression("[[2:_,0]es1/2,0,[4:_,0]es1/2,0]es1/4")
  assert({"value":2,"_nextSegment":1/4,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 0))
  assert({"value":1,"_nextSegment":1/4,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 1/8))
  assert({"value":0,"_nextSegment":2/4,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 2/8))
  assert({"value":2,"_nextSegment":2/4,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 3/8))
  assert({"value":0,"_nextSegment":3/4,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 4/8))
  assert({"value":0,"_nextSegment":3/4,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 5/8))

  p = parseExpression("[[1:!,0]es1,1+[1:!,0]es1]es1")
  assert({"value":1,"_nextSegment":1,"_segmentPower":2}, evalParamFrame(p, ev(0,0,1), 0))
  assert({"value":0.5183156388887342,"_nextSegment":1,"_segmentPower":2}, evalParamFrame(p, ev(0,0,1), 1/2))
  assert({"value":1,"_nextSegment":2,"_segmentPower":0}, evalParamFrame(p, ev(0,0,1), 1))
  assert(1, evalParamFrame(p, ev(0,0,1), 2))

  p = parseExpression("2000*[[1,0,1,0,1]es,0]es")
  assert({"value":2000,"_nextSegment":1/4,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 0))
  assert({"value":0,"_nextSegment":2/4,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 1/4))
  assert({"value":1000,"_nextSegment":3/4,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 2/4))
  assert({"value":0,"_nextSegment":4/4,"_segmentPower":1}, evalParamFrame(p, ev(0,0,1), 3/4))
  assert(0, evalParamFrame(p, ev(0,0,1), 4/4))

  p = parseExpression("2000*[[1,0,1]es1/2:4,0]es")
  assert({"value":0,"_nextSegment":2+2/2,"_segmentPower":1}, evalParamFrame(p, ev(0,2,1), 2+2/4))

  p = parseExpression('[0,1]e')
  e = {idx:0, count:0, dur:1, _time:0, endTime:2, countToTime:x=>x*2}
  assert(0, evalParamFrame(p, e,0))
  assert(1/2, evalParamFrame(p, e,1/2))
  assert(3/4, evalParamFrame(p, e,3/4))
  assert(1, evalParamFrame(p, e,1))

  v = evalParamFrame(parseExpression("mockaudionode>>mockaudionode"), ev(),0)
  assert(true, v instanceof AudioNode)
  assert(true, v.l instanceof AudioNode)
  assert(true, v.r instanceof AudioNode)

  v = evalParamFrame(parseExpression("(mockaudionode>>mockaudionode)>>mockaudionode"), ev(),0)
  assert(true, v instanceof AudioNode)
  assert(true, v.l instanceof AudioNode)
  assert(true, v.l.l instanceof AudioNode)
  assert(true, v.l.r instanceof AudioNode)
  assert(true, v.r instanceof AudioNode)

  v = evalParamFrame(parseExpression("mockaudionode>>(mockaudionode>>mockaudionode)"), ev(),0)
  assert(true, v instanceof AudioNode)
  assert(true, v.l instanceof AudioNode)
  assert(true, v.r instanceof AudioNode)
  assert(true, v.r.l instanceof AudioNode)
  assert(true, v.r.r instanceof AudioNode)

  v = evalParamFrame(parseExpression("{mockaudionode,mockaudionode}"), ev(),0)
  assert(true, v.value instanceof AudioNode)
  assert(true, v.value1 instanceof AudioNode)

  v = evalParamFrame(parseExpression("mockaudionode>>{mockaudionode,mockaudionode}"), ev(),0)
  assert(true, v instanceof AudioNode)
  assert(true, v.l instanceof AudioNode)
  assert(true, v.r.value instanceof AudioNode) // array contents is not getting evalled for some reason
  assert(true, v.r.value1 instanceof AudioNode)

  v = evalParamFrame(parseExpression("{mockaudionode,mockaudionode>>mockaudionode}>>mockaudionode"), ev(),0)
  assert(true, v instanceof AudioNode)
  assert(true, v.l.value instanceof AudioNode)
  assert(true, v.l.value1 instanceof AudioNode)
  assert(true, v.l.value1.l instanceof AudioNode)
  assert(true, v.l.value1.r instanceof AudioNode)
  assert(true, v.r instanceof AudioNode)

  vars.foo = parseExpression('{}->1')
  p = parseExpression('foo')
  assert(1, evalParamFrame(p, ev(), 0))
  delete vars.foo

  vars.foo = parseExpression('{value} -> value^2')
  p = parseExpression('foo{3}')
  assert(9, evalParamFrame(p, ev(), 0))
  delete vars.foo

  vars.bar = parseExpression('3')
  vars.foo = parseExpression('{value} -> value*bar')
  p = parseExpression('foo{4}')
  assert(12, evalParamFrame(p, ev(), 0))
  delete vars.foo
  delete vars.bar

  assert(1, evalParamFrameWithInterval(parseExpression('1'), ev(0),0))
  assert(1, evalParamFrameWithInterval(parseExpression('1@e'), ev(0),0))
  assert(1, evalParamFrameWithInterval(parseExpression('1@f'), ev(0),0))
  assert('s', evalParamFrameWithInterval(parseExpression("'s'"), ev(0),0))
  assert([1,2], evalParamFrameWithInterval(parseExpression('(1,2)'), ev(0),0))
  assert(1, evalParamFrameWithInterval(parseExpression('[1]'), ev(0),0))
  assert(1, evalParamFrameWithInterval(parseExpression('[1]t'), ev(0),0))
  assert(1, evalParamFrameWithInterval(parseExpression('[1]t@e'), ev(0),0))
  assert({value:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[1]t@f'), ev(0),0))
  assert({value:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[[1]t@f]t@f'), ev(0),0))
  assert({value:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[[1]t@e]t@f'), ev(0),0))
  assert({value:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[1]e'), ev(0),0))
  assert(2, evalParamFrameWithInterval(parseExpression('1+1'), ev(0),0))
  assert(2, evalParamFrameWithInterval(parseExpression('1+[1]'), ev(0),0))
  assert(2, evalParamFrameWithInterval(parseExpression('[1]t@e+[1]t@e'), ev(0),0))
  assert({value:2,interval:'frame'}, evalParamFrameWithInterval(parseExpression('1+[1]t@f'), ev(0),0))
  assert({value:2,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[1]t@f+1'), ev(0),0))
  assert({value:2,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[1]t@e+[1]t@f'), ev(0),0))
  assert({value:2,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[1]t@f+[1]t@e'), ev(0),0))
  assert({value:2,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[1]t@f+[1]t@f'), ev(0),0))
  assert({foo:1}, evalParamFrameWithInterval(parseExpression('{foo:1}'), ev(0),0))
  assert({foo:{value:1,interval:'frame'}}, evalParamFrameWithInterval(parseExpression('{foo:[1]t@f}'), ev(0),0))
  assert({foo:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[{foo:1}]t@f'), ev(0),0))
  assert({value:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[[1]t@f]t'), ev(0),0))
  assert({value:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[[1]t@f]t@f'), ev(0),0))
  assert({value:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[[1]t@e]t@f'), ev(0),0))
  assert(1, evalParamFrameWithInterval(parseExpression('[[1]t@f]t@e'), ev(0),0))
  assert({"value":1,"_nextSegment":1,"_segmentPower":1}, evalParamFrameWithInterval(parseExpression('[1,0]es1'), ev(0,0,1),0))
  assert({"test":{"value":440}}, evalParamFrameWithInterval(parseExpression('mockaudionode'), ev(0),0))
  assert(1, evalParamFrameWithInterval(parseExpression('[1]r'), ev(0),0))
  assert({value:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[1]r@f'), ev(0),0))
  assert({value:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[1]r{seed:[1]t@f}'), ev(0),0))
  vars.foo = parseExpression('1'); assert(1, evalParamFrameWithInterval(parseExpression('foo'), ev(), 0)); delete vars.foo
  vars.foo = parseExpression('[1]t@f'); assert({value:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('foo'), ev(), 0)); delete vars.foo
  vars.fooe = parseExpression('[1]t@e'); assert(1, evalParamFrameWithInterval(parseExpression('fooe'), ev(), 0)); delete vars.foo
  vars.foo = parseExpression('[1]t@f'); assert({value:2,interval:'frame'}, evalParamFrameWithInterval(parseExpression('foo+1'), ev(), 0)); delete vars.foo
  vars.foo = parseExpression('1'); assert({value:2,interval:'frame'}, evalParamFrameWithInterval(parseExpression('foo+[1]t@f'), ev(), 0)); delete vars.foo
  vars.foo = parseExpression('[1]t@f'); assert({value:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[foo]t@f'), ev(), 0)); delete vars.foo
  vars.foo = parseExpression('[1]t@f'); assert({value:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[foo]t'), ev(), 0)); delete vars.foo
  vars.fooe = parseExpression('[1]t@e'); assert(1, evalParamFrameWithInterval(parseExpression('[fooe]t'), ev(), 0)); delete vars.foo
  assert(1, evalParamFrameWithInterval(parseExpression('{foo:1}.foo'), ev(0),0))
  assert({value:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('{foo:[1]t@f}.foo'), ev(0),0))
  assert({value:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('time'), ev(0),1))
  assert({value:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[1]{time}'), ev(0),1))

  vars.foo = parseExpression('{value} -> value*2')
  assert(8, evalParamFrameWithInterval(parseExpression('foo{4}'), ev(), 0))
  assert(8, evalParamFrameWithInterval(parseExpression('foo{[4]}'), ev(), 0))
  e = ev(0,0,4)
  assert({value:8,interval:'frame'}, evalParamFrameWithInterval(parseExpression('foo{[4,5]t1@f}'), e, 0))
  assert({value:10,interval:'frame'}, evalParamFrameWithInterval(parseExpression('foo{[4,5]t1@f}'), e, 1))
  delete vars.foo

  vars.foo = parseExpression('{value} -> value*[2,3]t1@f')
  e = ev(0,0,4)
  assert({value:8,interval:'frame'}, evalParamFrameWithInterval(parseExpression('foo{4}'), e, 0))
  assert({value:12,interval:'frame'}, evalParamFrameWithInterval(parseExpression('foo{4}'), e, 1))
  assert({value:8,interval:'frame'}, evalParamFrameWithInterval(parseExpression('foo{[4]}'), e, 0))
  assert({value:8,interval:'frame'}, evalParamFrameWithInterval(parseExpression('foo{[4,5]t1@f}'), e, 0))
  assert({value:15,interval:'frame'}, evalParamFrameWithInterval(parseExpression('foo{[4,5]t1@f}'), e, 1))
  delete vars.foo

  vars.foo = parseExpression('{value} -> mockaudionode{test:value}')
  p = parseExpression('foo{[4,5]t1@f}')
  e = ev(0,0,4)
  v = evalParamFrame(p, e,0) // Creates mockaudionode and sets up per-frame callback, which evals the value arg, which is [4,5]t1@f
  assert(4, v.test.value)
  let system = require('play/system')
  assert(1, system.queued.length)
  system.queued[0].update({count:1,time:1}) // Call the per-frame callback; should update mockaudionode test value
  assert(5, v.test.value)
  system.queued = []
  delete vars.foo
  
  assert(1, evalParamFrameWithInterval(parseExpression('[1]r{seed:[1]t@f}@e'), ev(0),0))
  assert(1, evalParamFrameWithInterval(parseExpression('[1]t{per:[1]t@f}@e'), ev(0),0))
  // assert({value:1,interval:'frame'}, evalParamFrameWithInterval(parseExpression('[1]t{per:[1]t@f}'), ev(0),0)) // Probably should hoist interval up from modifiers..?

  assert(1, evalParamFrame(parseExpression('{}->1'), ev(), 0))
  assert(1, evalParamFrame(parseExpression('({}->1){}'), ev(), 0))
  assert(9, evalParamFrame(parseExpression('({value} -> value^2){3}'), ev(), 0))
  assert(9, evalParamFrame(parseExpression('({x} -> x^2){x:3}'), ev(), 0))
  assert(12, evalParamFrame(parseExpression('({value,x} -> value*x){3,x:4}'), ev(), 0))
  assert(12, evalParamFrame(parseExpression('({value,value1} -> value*value1){3,4}'), ev(), 0))
  assert(12, evalParamFrame(parseExpression('({x,y} -> x*y){x:3,y:4}'), ev(), 0))
  assert(undefined, parseExpression('{}->1').interval)
  assert('event', parseExpression('{}->[]r@e').interval)
  assert('frame', parseExpression('{}->[]r@f').interval)
  e = ev()
  assert(2, evalParamFrame(parseExpression('({value}->value*2){[1,3]t1@e}'), e, 0))
  assert(2, evalParamFrame(parseExpression('({value}->value*2){[1,3]t1@e}'), e, 1))
  e = ev()
  assert(2, evalParamFrame(parseExpression('({value}->value*2){[1,3]t1@f}'), e, 0))
  assert(6, evalParamFrame(parseExpression('({value}->value*2){[1,3]t1@f}'), e, 1))

  // assert(9, evalParamFrame(parseExpression('({x} -> x^2){3}'), ev(), 0))
  // assert(9, evalParamFrame(parseExpression('({x:3} -> x^2){}'), ev(), 0))
  // piecewise inside function body
  // timevar args passed in or used inside body
  // this var passed in or used inside body
  // function in one param called from another (this.sine){220}
  // {value}->value*2{3} : get nasty error not helpful error  
  // modifiers
  // more nested combinations; [{([]t@f)}]t etc etc

  console.log('Parse expression tests complete')
  }

  return parseExpression
})
