'use strict';
define(function(require) {
  let eatWhitespace = require('expression/eat-whitespace')
  let {hoistInterval,parseInterval,setInterval} = require('expression/intervals')
  let {parseRandom, simpleNoise} = require('expression/eval-randoms')
  let {timeVar, linearTimeVar, smoothTimeVar, eventTimeVar} = require('expression/eval-timevars')
  let addModifiers = require('expression/time-modifiers').addModifiers
  let parseMap = require('expression/parse-map')
  let parseArray = require('expression/parse-array')
  let number = require('expression/parse-number')
  let {piecewise} = require('expression/eval-piecewise')

  let iOperators = {
    '_': (i) => 0, // step
    '|': (i) => 1, // jump
    '/': (i) => i, // linear
    '\\': (i) => i, // linear
    '~': (i) => i*i*(3-2*i), // smooth bezier ease in/out,
  }

  let parseEntry = (state, vs, is, ss) => {
    eatWhitespace(state)
    let v = state.expression(state)
    if (v === undefined) { return false }
    let i = undefined
    let s = undefined
    eatWhitespace(state)
    if (state.str.charAt(state.idx) === ':') {
      state.idx+=1
      let char = state.str.charAt(state.idx)
      if (iOperators[char]) {
        state.idx+=1
        i = char
      }
      eatWhitespace(state)
      s = number(state)
    }
    vs.push(v)
    is.push(i)
    ss.push(s)
    eatWhitespace(state)
    if (state.str.charAt(state.idx) === ',') { state.idx+=1 }
    return true
  }

  let parsePiecewiseArray = (state) => {
    let char = state.str.charAt(state.idx)
    if (char !== '[') { return undefined }
    state.idx+=1
    let vs = []
    let is = []
    let ss = []
    while (parseEntry(state, vs, is, ss)) {}
    if (state.str.charAt(state.idx) === ']') { state.idx+=1 }
    return {vs:vs,is:is,ss:ss}
  }

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

  let parsePiecewise = (state) => {
    if (state.str.charAt(state.idx) !== '[') { return undefined }
    let rState = Object.assign({}, state)
    let rvs = parseArray(rState, '[', ']')
    let {vs,is,ss} = parsePiecewiseArray(state)
    if (rvs.separator === ':') { // Use parseArray to keep old style [1:4] range syntax going
      Object.assign(state, rState)
      vs = rvs
      is = rvs.map(() => undefined)
      ss = rvs.map(() => undefined)
    }
    let result
    if (state.str.charAt(state.idx).toLowerCase() == 't') { // timevar; values per time interval
      state.idx += 1
      let ds = numberOrArrayOrFour(state)
      let modifiers = parseMap(state)
      result = timeVar(vs, ds)
      result = addModifiers(result, modifiers)
      let interval = parseInterval(state) || hoistInterval('event', vs)
      setInterval(result, interval)
    } else if (state.str.charAt(state.idx).toLowerCase() == 'l') { // linearly interpolated timevar
      state.idx += 1
      let ds = numberOrArrayOrFour(state)
      let modifiers = parseMap(state)
      result = linearTimeVar(vs, ds)
      result = addModifiers(result, modifiers)
      let interval = parseInterval(state) || hoistInterval('event', vs)
      setInterval(result, interval)
    } else if (state.str.charAt(state.idx).toLowerCase() == 's') { // smoothstep interpolated timevar
      state.idx += 1
      let ds = numberOrArrayOrFour(state)
      let modifiers = parseMap(state)
      result = smoothTimeVar(vs, ds)
      result = addModifiers(result, modifiers)
      let interval = parseInterval(state) || hoistInterval('event', vs)
      setInterval(result, interval)
    } else if (state.str.charAt(state.idx).toLowerCase() == 'r') { // random
      state.idx += 1
      let hold = number(state)
      let modifiers = parseMap(state)
      if (hold !== undefined) {
        if (modifiers === undefined) { modifiers = {} }
        modifiers.step = hold
        if (modifiers.seed === undefined) { modifiers.seed = Math.random()*99999 } // Must set a seed for hold, otherwise every event gets a different seed and the random isn't held across events
      }
      result = parseRandom(vs)
      result = addModifiers(result, modifiers)
      let interval = parseInterval(state) || hoistInterval('event', vs, modifiers)
      setInterval(result, interval)
    } else if (state.str.charAt(state.idx).toLowerCase() == 'n') { // simple noise
      state.idx += 1
      let period = number(state)
      if (period === undefined) { period = 1 }
      let modifiers = parseMap(state)
      result = addModifiers(simpleNoise(vs, period), modifiers)
      let interval = parseInterval(state) || hoistInterval('frame', modifiers)
      setInterval(result, interval)
    } else if (state.str.charAt(state.idx).toLowerCase() == 'e') { // interpolate through the event duration
      state.idx += 1
      let ds = numberOrArray(state)
      let modifiers = parseMap(state)
      result = eventTimeVar(vs, ds)
      result = addModifiers(result, modifiers)
      setInterval(result, parseInterval(state) || hoistInterval('frame', vs))
    } else { // Piecewise as a function not an expression
      is = is.map(i => iOperators[i || '/']) // Default to linear interpolation
      ss = ss.map(s => s!==undefined ? s : 1) // Default to size 1
      let modifiers = parseMap(state)
      if (modifiers === undefined) { modifiers = {value: (e,b) => e.idx} } // Default to index with event index
      if (modifiers.value === undefined) { modifiers.value = (e,b) => e.idx } // Default to index with event index
      result = addModifiers(piecewise(vs, is, ss, modifiers.value), modifiers)
      setInterval(result, parseInterval(state) || hoistInterval('event', vs, modifiers))
    }
    return result
  }

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    let number = require('expression/parse-number') // Expressions should only be numbers in these tests for simplicity
    let st = (str) => { return {str:str, idx:0, expression:number} }
    let s

    assert(undefined, parsePiecewiseArray(st('')))
    assert(undefined, parsePiecewiseArray(st('a')))
    assert(undefined, parsePiecewiseArray(st('()')))
    assert({vs:[],is:[],ss:[]}, parsePiecewiseArray(st('[]')))
    assert({vs:[],is:[],ss:[]}, parsePiecewiseArray(st('[')))
    assert({vs:[],is:[],ss:[]}, parsePiecewiseArray(st('[]')))
    assert({vs:[],is:[],ss:[]}, parsePiecewiseArray(st('[]')))
    assert({vs:[],is:[],ss:[]}, parsePiecewiseArray(st('[ ]')))
    assert({vs:[],is:[],ss:[]}, parsePiecewiseArray(st('[,]')))
    assert({vs:[],is:[],ss:[]}, parsePiecewiseArray(st('[:]')))
    assert({vs:[],is:[],ss:[]}, parsePiecewiseArray(st('[:,]')))

    assert({vs:[5],is:[undefined],ss:[undefined]}, parsePiecewiseArray(st('[5]')))
    assert({vs:[5,6],is:[undefined,undefined],ss:[undefined,undefined]}, parsePiecewiseArray(st('[5,6]')))
    assert({vs:[5,6],is:[undefined,undefined],ss:[undefined,undefined]}, parsePiecewiseArray(st('[5,6,]')))
    assert({vs:[5,6],is:[undefined,undefined],ss:[undefined,undefined]}, parsePiecewiseArray(st('[ 5 , 6 , ]')))

    assert({vs:[5],is:[undefined],ss:[undefined]}, parsePiecewiseArray(st('[5]')))
    assert({vs:[5],is:[undefined],ss:[undefined]}, parsePiecewiseArray(st('[5')))
    assert({vs:[5],is:[undefined],ss:[undefined]}, parsePiecewiseArray(st('[5]]')))
    assert({vs:[5],is:[undefined],ss:[undefined]}, parsePiecewiseArray(st('[5,]')))
    assert({vs:[5],is:[undefined],ss:[undefined]}, parsePiecewiseArray(st('[5:]')))
    assert({vs:[5],is:[undefined],ss:[undefined]}, parsePiecewiseArray(st('[5:,]')))
    assert({vs:[5],is:[undefined],ss:[1]}, parsePiecewiseArray(st('[5:1]')))
    assert({vs:[5],is:[undefined],ss:[1]}, parsePiecewiseArray(st('[5:1,]')))
    assert({vs:[5],is:['/'],ss:[undefined]}, parsePiecewiseArray(st('[5:/]')))
    assert({vs:[5],is:['/'],ss:[undefined]}, parsePiecewiseArray(st('[5:/,]')))
    assert({vs:[5],is:['/'],ss:[1]}, parsePiecewiseArray(st('[5:/1]')))
    assert({vs:[5],is:['/'],ss:[1]}, parsePiecewiseArray(st('[5:/1,]')))
    assert({vs:[5],is:['/'],ss:[1]}, parsePiecewiseArray(st('[ 5 :/ 1 , ]')))

    assert({vs:[5,6],is:[undefined,undefined],ss:[1,undefined]}, parsePiecewiseArray(st('[5:1,6]')))
    assert({vs:[5,6],is:[undefined,undefined],ss:[undefined,1]}, parsePiecewiseArray(st('[5,6:1]')))
    assert({vs:[5,6],is:['/','_'],ss:[undefined,undefined]}, parsePiecewiseArray(st('[5:/,6:_]')))
    assert({vs:[5,6],is:['/','_'],ss:[1,2]}, parsePiecewiseArray(st('[5:/1,6:_2]')))
    assert({vs:[5,6],is:[undefined,undefined],ss:[1,undefined]}, parsePiecewiseArray(st('[5:1,6,]')))
    assert({vs:[5,6],is:[undefined,undefined],ss:[undefined,1]}, parsePiecewiseArray(st('[5,6:1,]')))
    assert({vs:[5,6],is:['/','_'],ss:[undefined,undefined]}, parsePiecewiseArray(st('[5:/,6:_,]')))
    assert({vs:[5,6],is:['/','_'],ss:[1,2]}, parsePiecewiseArray(st('[5:/1,6:_2,]')))
    assert({vs:[5,6],is:[undefined,undefined],ss:[1,2]}, parsePiecewiseArray(st('[5:1,6:2,]')))
    assert({vs:[5,6,7],is:['/','_',undefined],ss:[1,2,undefined]}, parsePiecewiseArray(st('[5:/1,6:_2,7]')))

    console.log('Parse piecewise tests complete')
  }

  return parsePiecewise
})