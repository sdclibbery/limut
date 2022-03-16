'use strict';
define(function(require) {
  let parseExpression = require('player/parse-expression')
  let {operators} = require('player/operators')
  let {newOverride} = require('player/override-params')

  let parseName = (state) => {
    let name = ''
    let char
    state.valueless = false
    while (char = state.str.charAt(state.idx)) {
      if (char == '=') {
        state.idx += 1
        let prevChar = state.str.charAt(state.idx - 2)
        let prevPrevChar = state.str.charAt(state.idx - 3)
        let isComment = prevChar == '/' && prevPrevChar == '/'
        if (!isComment && operators.hasOwnProperty(prevChar)) {
          return {name:name.slice(0,-1), operator:operators[prevChar]}
        }
        return {name:name}
      } else if (char == ',') {
        state.valueless = true
        state.idx += 1
        return {name:name}
      } else {
        name = name+char
        state.idx += 1
      }
    }
    state.valueless = true
    return {name:name}
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
    let {name, operator} = parseName(state)
    let value
    if (state.valueless) {
      value = '1'
    } else {
      value = parseValue(state).trim()
    }
    let commented
    if (name.includes('//')) {
      name = name.replace(/\/\/.*/, '')
      value = '1'
      commented = true
      operator = undefined
    }
    name = name.trim()
    if (name) {
      let v = parseExpression(value, () => commented=true, state.dependsOn, (state.context?state.context+'.':'')+name)
      if (operator) {
        v = newOverride(v, operator)
      }
      state.params[name.toLowerCase().trim()] = v
      if (commented) { return false }
      return true
    }
    return false
  }

  let parseParams = (paramsStr, dependsOn, context) => {
    let state = {
      str: paramsStr,
      idx: 0,
      params: {},
      bracketStack: [],
      dependsOn: dependsOn || [],
      context: context,
    }
    while (parseParam(state)) {}
    return state.params
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let {preEvalParam,evalParamFrame} = require('player/eval-param')
  let ev = (i,c) => {return{idx:i,count:c}}
  let p

  assert({}, parseParams(''))
  assert({}, parseParams('=1'))
  assert({dur:1}, parseParams('dur=1'))
  assert({dur:1}, parseParams('Dur=1'))
  assert({dur:1, oct:4}, parseParams('dur=1, oct=4'))
  assert({dur:4, oct:5, dec:2, att:2}, parseParams('dur=4, oct=5, dec=2, att=2'))
  assert({dur:1/2}, parseParams('dur=1/2'))
  assert({dur:1, oct:4}, parseParams('dur=1,oct=4'))
  assert({t:'a'}, parseParams("t='a'"))
  assert({s:'abc'}, parseParams("s='abc'"))
  assert({s:'a b  c'}, parseParams("s='a b  c'"))
  assert({s:'http://a.com/Bc.mp3'}, parseParams("s='http://a.com/Bc.mp3'"))
  assert({}, parseParams("//s='abc'"))
  assert({s:1}, parseParams("s//='abc'"))
  assert({}, parseParams("s=//'abc'"))
  assert({a:1}, parseParams("a=1,//s='abc'"))
  assert({a:1}, parseParams("a=1//,s='abc'"))
  assert({a:1}, parseParams("a=1, //s='abc'"))
  assert({a:1}, parseParams("a=1, //s='abc'"))
  assert({dur:1}, parseParams("dur=1// amp=0.1, rate=10"))
  assert({dur:1}, parseParams("dur=1//, amp=0.1, rate=10"))
  assert({dur:1}, parseParams("dur=1//1, amp=0.1, rate=10"))
  assert({dur:1}, parseParams("dur=1,// amp=0.1, rate=10"))
  assert({str:'http://', amp:0.1, rate:10}, parseParams("str='http://', amp=0.1, rate=10"))
  assert({window:1}, parseParams("window"))
  assert({amp:3,window:1,rate:2}, parseParams("amp=3, window, rate=2"))
  assert({amp:3,window:1}, parseParams("amp=3, window"))
  assert({window:1,rate:2}, parseParams("window, rate=2"))
  assert({window:1}, parseParams("window//, rate=2"))
  assert('event', parseParams("fore=[0,1]r").fore.interval)
  assert('event', parseParams("fore=[0,1]r4").fore.interval)
  assert('frame', parseParams("fore=[0,1]r@f").fore.interval)

  let exp = parseParams("amp=[0,1]t4@e+[2:3]l1@f").amp
  assert('function', typeof preEvalParam(exp, ev(0,0), 0))
  assert(2, evalParamFrame(exp, ev(0,0), 0))
  assert(3, evalParamFrame(exp, ev(0,0), 1))
  assert(2, evalParamFrame(exp, ev(0,0), 2))
  assert(3, evalParamFrame(exp, ev(0,0), 3))
  assert(3, evalParamFrame(exp, ev(0,0), 4))
  assert(4, evalParamFrame(exp, ev(0,0), 5))
  assert(3, evalParamFrame(exp, ev(4,4), 4))
  assert(4, evalParamFrame(exp, ev(4,4), 5))

  p = parseParams('add+=2').add
  assert(true, p._override)
  
  p = parseParams('add += 2').add
  assert(true, p._override)

  assert({'add+':2}, parseParams('add+ =2'))
  assert({add:1}, parseParams('add//+=2'))
  assert({'add+':1}, parseParams('add+//=2'))

  console.log("Params tests complete")
  }
  
  return parseParams
});
