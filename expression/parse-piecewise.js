'use strict';
define(function(require) {
  let eatWhitespace = require('expression/eat-whitespace')
  let {hoistInterval,parseInterval,setInterval} = require('expression/intervals')
  let {parseRandom, parseRangedRandom, simpleNoise} = require('expression/eval-randoms')
  let {timeVar, rangeTimeVar, eventTimeVar} = require('expression/eval-timevars')
  let addModifiers = require('expression/time-modifiers').addModifiers
  let parseMap = require('expression/parse-map')
  let number = require('expression/parse-number')
  let {piecewise} = require('expression/eval-piecewise')
  let parseArray = require('expression/parse-array')
  let parseUnits = require('expression/parse-units')

  let iOperators = {
    '_': (i) => 0, // step
    '|': (i) => 1, // jump
    '/': (i) => i, // linear
    '\\': (i) => i, // linear
    '~': (i) => i*i*(3-2*i), // smooth bezier ease in/out
    '!': (i) => 1-Math.exp(-8*i), // exponential
  }
  iOperators['_'].segmentPower = 0
  iOperators['|'].segmentPower = 0
  iOperators['/'].segmentPower = 1
  iOperators['\\'].segmentPower = 1
  iOperators['~'].segmentPower = 3
  iOperators['!'].segmentPower = 2

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
      s = state.expression(state)
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
      n = parseUnits(n, state)
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

  let parseRangeArray = (state) => {
    let result = []
    let char
    let colons = 0
    if (state.str.charAt(state.idx) !== '[') { return undefined }
    state.idx += 1
    let v = state.expression(state)
    if (v !== undefined) { result.push(v) }
    while (char = state.str.charAt(state.idx)) {
      if (char == ':') {
        if (result.length > 2) { return undefined }
        state.idx += 1
        let v = state.expression(state)
        if (v !== undefined) { result.push(v) }
        colons += 1
      } else if (char == ']') {
        state.idx += 1
        break
      } else {
        return undefined
      }
    }
    if (colons === 0) { return undefined } // Must have had a colon for it to be a ranged array
    return result
  }

  let parsePiecewise = (state) => {
    if (state.str.charAt(state.idx) !== '[') { return undefined }
    let rState = Object.assign({}, state)
    let rvs = parseRangeArray(rState)
    let {vs,is,ss} = parsePiecewiseArray(state)
    let ranged = rvs !== undefined
    if (ranged) { // Use parseRangeArray to keep old style [1:4] range syntax going
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
      let interval = parseInterval(state) || hoistInterval('event', vs)
      is = is.map(i => iOperators[i])
      if (ranged) {
        result = rangeTimeVar(vs, ds)
      } else {
        result = timeVar(vs, is, ss, ds, iOperators['_'])
      }
      result = addModifiers(result, modifiers)
      setInterval(result, interval)
    } else if (state.str.charAt(state.idx).toLowerCase() == 'l') { // linearly interpolated timevar
      state.idx += 1
      let ds = numberOrArrayOrFour(state)
      let modifiers = parseMap(state)
      let interval = parseInterval(state) || hoistInterval('event', vs)
      is = is.map(i => iOperators[i])
      result = timeVar(vs, is, ss, ds, iOperators['/'])
      result = addModifiers(result, modifiers)
      setInterval(result, interval)
    } else if (state.str.charAt(state.idx).toLowerCase() == 's') { // smoothstep interpolated timevar
      state.idx += 1
      let ds = numberOrArrayOrFour(state)
      let modifiers = parseMap(state)
      is = is.map(i => iOperators[i])
      result = timeVar(vs, is, ss, ds, iOperators['~'])
      result = addModifiers(result, modifiers)
      let interval = parseInterval(state) || hoistInterval('event', vs)
      setInterval(result, interval)
    } else if (state.str.charAt(state.idx).toLowerCase() == 'e') { // interpolate through the event duration
      state.idx += 1
      let addSegmentData = false
      if (state.str.charAt(state.idx).toLowerCase() == 's') { // []es segmented event timevar
        state.idx += 1
        addSegmentData = true
      }
      let ds = numberOrArray(state)
      let modifiers = parseMap(state)
      let interval = parseInterval(state) || hoistInterval('frame', vs)
      if (interval === 'segment')  { // @s: add segment data
        addSegmentData = true
      }
      is = is.map(i => iOperators[i])
      result = eventTimeVar(vs, is, ss, ds, addSegmentData)
      result = addModifiers(result, modifiers)
      setInterval(result, interval)
    } else if (state.str.charAt(state.idx).toLowerCase() == 'r') { // random
      state.idx += 1
      let hold = number(state)
      hold = parseUnits(hold, state)
      let modifiers = parseMap(state)
      if (hold !== undefined) {
        if (modifiers === undefined) { modifiers = {} }
        modifiers.step = hold
        if (modifiers.seed === undefined) { modifiers.seed = Math.random()*99999 } // Must set a seed for hold, otherwise every event gets a different seed and the random isn't held across events
      }
      is = is.map(i => iOperators[i])
      if (ranged) {
        result = parseRangedRandom(vs, is, ss)
      } else {
        result = parseRandom(vs, is, ss)
      }
      result = addModifiers(result, modifiers)
      let interval = parseInterval(state) || hoistInterval('event', vs, modifiers)
      setInterval(result, interval)
    } else if (state.str.charAt(state.idx).toLowerCase() == 'n') { // simple noise
      state.idx += 1
      let period = number(state)
      period = parseUnits(period, state)
      if (period === undefined) { period = 1 }
      let modifiers = parseMap(state)
      result = addModifiers(simpleNoise(vs, period), modifiers)
      let interval = parseInterval(state) || hoistInterval('frame', modifiers)
      setInterval(result, interval)
    } else { // Piecewise as a function not an expression
      is = is.map(i => iOperators[i || '/']) // Default to linear interpolation
      ss = ss.map(s => s!==undefined ? s : 1) // Default to size 1
      let modifiers = parseMap(state)
      if (modifiers === undefined) { modifiers = {value: (e,b) => e.idx} } // Default to index with event index
      if (modifiers.value === undefined) { modifiers.value = (e,b) => e.idx } // Default to index with event index
      result = addModifiers(piecewise(vs, is, ss, modifiers.value, {}), modifiers)
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