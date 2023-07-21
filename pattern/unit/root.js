'use strict';
define(function(require) {
  let literal = require('pattern/unit/literal.js')
  let param = require('player/default-param')
  let {mainParam} = require('player/sub-param')
  let {evalParamFrame} = require('player/eval-param')

  let calculatePatternInfo = (pattern, dur, tc) => {
    let idx = 0
    let count = 0
    let step
    let numNonRests = 0
    let numSteps = 0
    do {
      let duration = mainParam(evalParamFrame(dur, {idx: idx, count: count}, count), 1)
      if (duration <= 0) { throw 'Zero duration' }
      step = pattern.next()
      if (step !== undefined) {
        let e = step[0]
        if (e.value !== undefined) {
          numNonRests++
          idx++
        }
        count += duration * e.dur
      }
      numSteps++
      if (numSteps > 128) { // If the pattern is crazy long, act as if its a single stepper
        tc.patternLength = 1
        tc.isSingleStep = true
        pattern.reset()
        return
      }
    } while (step !== undefined)
    tc.patternLength = count
    tc.isSingleStep = numNonRests <= 1
  }

  let toPreviousStart = (pattern, count, dur, tc) => {
    calculatePatternInfo(pattern, dur, tc)
    let numRepeats = Math.trunc(count / tc.patternLength)
    tc.patternCount = tc.patternLength * numRepeats
    if (tc.isSingleStep) {
      tc.idx = numRepeats
    }
  }

  let initTimingContext = (tc, count, pattern, dur) => {
    pattern.reset()
    tc.idx = 0
    if (count === 0) { // At count 0; must be starting at the start of the pattern :-)
      calculatePatternInfo(pattern, dur, tc)
      tc.patternCount = 0
      return
    }
    toPreviousStart(pattern, count-1, dur, tc) // Jump to the pattern restart point just before count-1
    stepToCount(count-1, dur, pattern, tc) // Step through the pattern to count-1 to update the tc count and idx
  }

  let stepToCount = (count, dur, pattern, tc) => {
    let eventsForBeat = []
    while (tc.patternCount < count + 0.9999) {
      let duration = mainParam(evalParamFrame(dur, {idx: tc.idx, count: tc.patternCount}, count), 1)
      if (duration <= 0) { throw 'Zero duration' }
      let chord = pattern.next()
      if (chord === undefined) { // End of pattern
        pattern.reset() // Loop pattern: reset back to start
        if (!tc.isSingleStep) {
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
        initTimingContext(tc, count, pattern, dur)
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

    p = root('0', {})
    assert([{value:"0",dur:1,_time:0,count:2,idx:2}], p(2)) // Start at count 2
    assert([{value:"0",dur:1,_time:0,count:3,idx:3}], p(3))

    p = root('0123', {})
    assert([{value:"2",dur:1,_time:0,count:2,idx:2}], p(2)) // Start at count 2
    assert([{value:"3",dur:1,_time:0,count:3,idx:3}], p(3))
    assert([{value:"0",dur:1,_time:0,count:4,idx:0}], p(4))

    p = root('0123', {dur:1/2})
    assert([{value:"2",dur:1/2,_time:0,count:1,idx:2},{value:"3",dur:1/2,_time:1/2,count:3/2,idx:3}], p(1)) // Start at 1
    assert([{value:"0",dur:1/2,_time:0,count:2,idx:0},{value:"1",dur:1/2,_time:1/2,count:5/2,idx:1}], p(2))

    p = root('01', {dur:2})
    assert([], p(1)) // Start at 1
    assert([{value:"1",dur:2,_time:0,count:2,idx:1}], p(2))

    p = root('01', {dur:()=>1})
    assert([{value:"1",dur:1,_time:0,count:1,idx:1}], p(1)) // Start at 1
    assert([{value:"0",dur:1,_time:0,count:2,idx:0}], p(2))

    p = root('012'.repeat(128), {}) // Very long string
    assert([{value:"1",dur:1,_time:0,count:1,idx:1}], p(1)) // Start at 1
    assert([{value:"2",dur:1,_time:0,count:2,idx:2}], p(2))
    assert([{value:"0",dur:1,_time:0,count:3,idx:3}], p(3)) // As if its a single step pattern

    console.log("Pattern unit root tests complete")
  }
  
  return root
});
