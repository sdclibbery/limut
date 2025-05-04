'use strict';
define(function(require) {
  let eatWhitespace = require('expression/eat-whitespace')

  let combine = (l, r) => {
    if (l === 'segment' || r === 'segment') { return 'segment' }
    if (l === 'frame' || r === 'frame') { return 'frame' }
    if (l === 'event' || r === 'event') { return 'event' }
    return undefined
  }

  let findInterval = (v) => {
    let result = v&&v.interval
    if (result === undefined && typeof v === 'object' && !(v instanceof AudioNode)) {
      result = v.interval
      for (let k in v) {
        if (v[k] !== undefined) {
          result = combine(result, v[k].interval)
        }
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
      } else if (state.str.charAt(state.idx) == 's') {
        state.idx += 1
        result = 'segment'
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
    let perSegmentFunc = () => 0
    perSegmentFunc.interval = 'segment'

    assert(undefined, combineIntervalsFrom(0, 1))

    assert('event', combineIntervalsFrom(perEventFunc, perEventFunc))
    assert('frame', combineIntervalsFrom(perFrameFunc, perFrameFunc))
    assert('segment', combineIntervalsFrom(perSegmentFunc, perSegmentFunc))

    assert('event', combineIntervalsFrom(perEventFunc, 0))
    assert('event', combineIntervalsFrom(0, perEventFunc))
    assert('frame', combineIntervalsFrom(perFrameFunc, 0))
    assert('frame', combineIntervalsFrom(0, perFrameFunc))
    assert('segment', combineIntervalsFrom(perSegmentFunc, 0))
    assert('segment', combineIntervalsFrom(0, perSegmentFunc))

    assert('frame', combineIntervalsFrom(perEventFunc, perFrameFunc))
    assert('segment', combineIntervalsFrom(perEventFunc, perSegmentFunc))
    assert('segment', combineIntervalsFrom(perFrameFunc, perSegmentFunc))
    assert('frame', combineIntervalsFrom(perFrameFunc, perEventFunc))
    assert('segment', combineIntervalsFrom(perSegmentFunc, perEventFunc))
    assert('segment', combineIntervalsFrom(perSegmentFunc, perFrameFunc))

    assert('event', combineIntervalsFrom(0, {foo:perEventFunc}))
    assert('frame', combineIntervalsFrom(0, {foo:perFrameFunc}))
    assert('event', combineIntervalsFrom({foo:perEventFunc}, 0))
    assert('frame', combineIntervalsFrom({foo:perFrameFunc}, 0))

    console.log('Intervals tests complete')
  }
  
  return {
    combineIntervals:combine,
    combineIntervalsFrom: combineIntervalsFrom,
    hoistInterval: hoistInterval,
    parseInterval: parseInterval,
    setInterval: setInterval,
  }
})