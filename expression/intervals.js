'use strict';
define(function(require) {
  let eatWhitespace = require('expression/eat-whitespace')

  let combine = (l, r) => {
    return l === 'frame' ? 'frame' : (r === 'frame' ? 'frame' : (l || r))
  }

  let findInterval = (v) => {
    let result = v&&v.interval
    if (result === undefined && typeof v === 'object') {
      result = v.interval
      for (let k in v) {
        result = combine(result, v[k].interval)
      }
    }
    return result
  }

  let combineIntervalsFrom = (l, r) => {
    return combine(findInterval(l), findInterval(r))
  }

  let hoistInterval = (def, ...args) => {
    let interval = def
    args.forEach(arg => {
      if (Array.isArray(arg)) {
        interval = arg.map(v => v.interval).reduce(combine, interval)
      } else if (!!arg) {
        interval = Object.values(arg).flat().map(v => v.interval).reduce(combine, interval)
      }
    })
    return interval
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

  // TESTS
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  
    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }

    let perEventFunc = () => 0
    perEventFunc.interval = 'event'
    let perFrameFunc = () => 0
    perFrameFunc.interval = 'frame'

    assert(undefined, combineIntervalsFrom(0, 1))
    assert('event', combineIntervalsFrom(perEventFunc, perEventFunc))
    assert('frame', combineIntervalsFrom(perEventFunc, perFrameFunc))
    assert('frame', combineIntervalsFrom(perFrameFunc, perFrameFunc))
    assert('event', combineIntervalsFrom(0, {foo:perEventFunc}))
    assert('frame', combineIntervalsFrom(0, {foo:perFrameFunc}))
    assert('event', combineIntervalsFrom({foo:perEventFunc}, 0))
    assert('frame', combineIntervalsFrom({foo:perFrameFunc}, 0))

    console.log('Intervals tests complete')
  }
  
  return {
    combineIntervalsFrom: combineIntervalsFrom,
    hoistInterval: hoistInterval,
    parseInterval: parseInterval,
    setInterval: setInterval,
  }
})