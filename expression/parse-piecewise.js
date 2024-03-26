'use strict';
define(function(require) {
  let {hoistInterval,parseInterval,setInterval} = require('expression/intervals')
  let {parseRandom, simpleNoise} = require('expression/eval-randoms')
  let {timeVar, linearTimeVar, smoothTimeVar, eventTimeVar, eventIdxVar} = require('expression/eval-timevars')
  let parseArray = require('expression/parse-array')
  let addModifiers = require('expression/time-modifiers').addModifiers
  let parseMap = require('expression/parse-map')
  let number = require('expression/parse-number')

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
    let char = state.str.charAt(state.idx)
    if (char !== '[') { return undefined }
    let vs = parseArray(state, '[', ']')
    let result
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
        if (hold !== undefined) {
        if (modifiers === undefined) { modifiers = {} }
        modifiers.step = hold
        if (modifiers.seed === undefined) { modifiers.seed = Math.random()*99999 } // Must set a seed for hold, otherwise every event gets a different seed and the random isn't held across events
        }
        let interval = parseInterval(state) || hoistInterval('event', vs, modifiers)
        result = addModifiers(parseRandom(vs), modifiers)
        setInterval(result, interval)
    } else if (state.str.charAt(state.idx).toLowerCase() == 'n') { // simple noise
        state.idx += 1
        let period = number(state)
        if (period === undefined) { period = 1 }
        let modifiers = parseMap(state)
        let interval = parseInterval(state) || hoistInterval('frame', modifiers)
        result = addModifiers(simpleNoise(vs, period), modifiers)
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
    return result
  }

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }

    // assert(undefined, parsePiecewise({str:'',idx:0}))

    console.log('Parse piecewise tests complete')
  }

  return parsePiecewise
})