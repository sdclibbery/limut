'use strict';
define(function(require) {
  let literal = require('pattern/unit/literal.js')
  let param = require('player/default-param')

  let stepToCount = (count, dur, pattern, tc) => {
    let eventsForBeat = []
    while (tc.patternCount < count + 0.9999) {
      let duration = dur//mainParam(evalParamFrame(dur, {idx: tc.idx, count: tc.patternCount}, count), 1)
      // if (duration <= 0) { throw 'Zero duration' }
      let chord = pattern.next()
      if (chord === undefined) { // End of pattern
        pattern.reset() // Loop pattern: reset back to start
        if (tc.idxOnFirstRepeat === undefined) { tc.idxOnFirstRepeat = tc.idx }
        if (tc.idxOnFirstRepeat > 1) {
          tc.idx = 0 // Reset idx, but only if pattern length is > 1
        }
        chord = pattern.next()
      }
      let anyNotRest = false
      chord.forEach(sourceEvent => {
        let isRest = sourceEvent.value === undefined
        if (!isRest) { anyNotRest = true }
        let event = {}
        event.value = sourceEvent.value
        event.dur = sourceEvent.dur * duration
        event._time = tc.patternCount - count
        event.count = count + event._time
        event.idx = tc.idx
        // if (!isRest) { // No point setting up loads of data on rests that will be discarded anyway
        //   event.sharp = sourceEvent.sharp
        //   event.loud = sourceEvent.loud
        //   event.long = sourceEvent.long
        // }
        eventsForBeat.push(event)
      })
      let lastEvent = eventsForBeat[eventsForBeat.length-1]
      tc.patternCount += lastEvent.dur // Events in a chord are pre-sorted so shortest duration is last
      if (anyNotRest) { tc.idx++ }
    }
    return eventsForBeat
  }

  let root = (patternStr, params) => {
    patternStr = patternStr.trim()
    if (!patternStr) { return () => [] }
    let state = {
      str: patternStr,
      idx: 0,
    }
    let pattern = literal(state)
    let dur = param(params.dur, 1)
    let tc = {}
    return (count) => {
      if (!tc.inited) {
        tc.inited = true
        pattern.toStep(count / dur)
        tc.patternCount = count
        tc.idx = 0
      }
      return stepToCount(count, dur, pattern, tc)
              .filter(({value}) => value !== undefined) // Discard rests
    }
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual, msg) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}\n${msg}`) }
    }
    let assertSamePattern = (a, b) => {
      for (let i=0; i<100; i++) {
        assert(a(i), b(i), `i: ${i}`)
      }
    }
    let p

    p = root('0', {})
    assert([{value:"0",dur:1,_time:0,count:0,idx:0}], p(0))
    assert([{value:"0",dur:1,_time:0,count:1,idx:1}], p(1))
    assert([{value:"0",dur:1,_time:0,count:2,idx:2}], p(2))

    p = root('01', {})
    assert([{value:"0",dur:1,_time:0,count:0,idx:0}], p(0))
    assert([{value:"1",dur:1,_time:0,count:1,idx:1}], p(1))
    assert([{value:"0",dur:1,_time:0,count:2,idx:0}], p(2))
    assert([{value:"1",dur:1,_time:0,count:3,idx:1}], p(3))

    p = root('0.1', {})
    assert([{value:"0",dur:1,_time:0,count:0,idx:0}], p(0))
    assert([], p(1))
    assert([{value:"1",dur:1,_time:0,count:2,idx:1}], p(2))

    p = root('01.2', {dur:1/2})
    assert([{value:"0",dur:1/2,_time:0,count:0,idx:0},{value:"1",dur:1/2,_time:1/2,count:1/2,idx:1}], p(0))
    assert([{value:"2",dur:1/2,_time:1/2,count:3/2,idx:2}], p(1))

    p = root('01.2', {dur:1/4})
    assert([{value:"0",dur:1/4,_time:0,count:0,idx:0},{value:"1",dur:1/4,_time:1/4,count:1/4,idx:1},{value:"2",dur:1/4,_time:3/4,count:3/4,idx:2}], p(0))
    assert([{value:"0",dur:1/4,_time:0,count:1,idx:0},{value:"1",dur:1/4,_time:1/4,count:5/4,idx:1},{value:"2",dur:1/4,_time:3/4,count:7/4,idx:2}], p(1))

    assertSamePattern(root('01.2', {dur:1/4}), root('[01.2]', {}))
    assertSamePattern(root('[01][.2]', {dur:1/2}), root('[01.2]', {}))

    p = root('01', {dur:2})
    assert([{value:"0",dur:2,_time:0,count:0,idx:0}], p(0))
    assert([], p(1))
    assert([{value:"1",dur:2,_time:0,count:2,idx:1}], p(2))
    assert([], p(3))
    assert([{value:"0",dur:2,_time:0,count:4,idx:0}], p(4))

    p = root('01', {dur:2.5})
    assert([{value:"0",dur:2.5,_time:0,count:0,idx:0}], p(0))
    assert([], p(1))
    assert([{value:"1",dur:2.5,_time:1/2,count:2.5,idx:1}], p(2))
    assert([], p(3))
    assert([], p(4))
    assert([{value:"0",dur:2.5,_time:0,count:5,idx:0}], p(5))

    p = root('0[12]', {})
    assert([{value:"0",dur:1,_time:0,count:0,idx:0}], p(0))
    assert([{value:"1",dur:1/2,_time:0,count:1,idx:1},{value:"2",dur:1/2,_time:1/2,count:3/2,idx:2}], p(1))
    assert([{value:"0",dur:1,_time:0,count:2,idx:0}], p(2))

    p = root('0123', {})
    assert([{value:"2",dur:1,_time:0,count:2,idx:2}], p(2)) // Start at count 2
    assert([{value:"3",dur:1,_time:0,count:3,idx:3}], p(3))
    assert([{value:"0",dur:1,_time:0,count:4,idx:0}], p(4))

    p = root('0123', {dur:1/2})
    assert([{value:"2",dur:1/2,_time:0,count:1,idx:2},{value:"3",dur:1/2,_time:1/2,count:3/2,idx:3}], p(1))
    assert([{value:"0",dur:1/2,_time:0,count:2,idx:0},{value:"1",dur:1/2,_time:1/2,count:5/2,idx:1}], p(2))

    p = root('01', {dur:2})
    assert([], p(1))
    assert([{value:"1",dur:2,_time:0,count:2,idx:1}], p(2))

    console.log("Pattern unit root tests complete")
  }
  
  return root
});
