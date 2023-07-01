'use strict';
define(function(require) {
  let param = require('player/default-param')
  let parsePatternLiteral = require('pattern/parse-pattern-literal')
  let {evalParamFrame} = require('player/eval-param')
  let {mainParam} = require('player/sub-param')

  let getEvent = (events, timingContext) => {
    let e = events[timingContext._patternIdx]
    if (typeof e.value === 'function') {
      let es = e.value(e, timingContext._patternRepeats)
      return es[timingContext._subPatternIdx]
    }
    return e
  }

  let nextEventMaybeLoop = (events, timingContext) => {
    let e = events[timingContext._patternIdx]
    if (typeof e.value === 'function') {
      timingContext._subPatternIdx++ // Step through sub pattern
      let subLength = e.value(e, timingContext._patternRepeats).length
      if (timingContext._subPatternIdx < subLength) { return false } // Still in the subpattern, didn't loop the main pattern
      timingContext._subPatternIdx = 0 // Looped around the subpattern; fall through and also step through main pattern
    }
    timingContext._patternIdx++ // Step through main pattern
    if (timingContext._patternIdx >= events.length) {
      timingContext._patternIdx = 0
      timingContext._patternRepeats++
      return true // Looped around the main pattern
    }
    return false // Didn't loop
  }

  let calculatePatternLength = (dur, events) => {
    let length = 0
    let patternIdx = 0
    let idx = 0
    let lastTime = -1
    do {
      let e = events[patternIdx]
      if (e._time !== lastTime){
        let durEvalled = evalParamFrame(dur, {idx: idx, count: length}, length)
        let duration = mainParam(durEvalled, 1)
        if (duration <= 0) { throw 'Zero duration' }
        length += duration * e.dur
        if (e.value !== undefined) { idx++ }
      }
      lastTime = e._time
      patternIdx++
    } while (patternIdx < events.length)
    return length
  }

  let getNextChord = (events, timingContext) => {
    //!!Changes here must be mirrored in stepToCountFast!!
    let event = getEvent(events, timingContext)
    let chordTime = event._time
    let result = []
    do {
      result.push(event)
      if (nextEventMaybeLoop(events, timingContext)) { break }
      event = getEvent(events, timingContext)
    } while (event._time === chordTime)
    return result
  }

  let stepToCount = (count, dur, events, timingContext) => {
    //!!Changes here must be mirrored in stepToCountFast!!
    let eventsForBeat = []
    while (timingContext._patternCount < count + 0.9999) {
      let duration = mainParam(evalParamFrame(dur, {idx: timingContext._idx, count: timingContext._patternCount}, count), 1)
      if (duration <= 0) { throw 'Zero duration' }
      let chord = getNextChord(events, timingContext)
      let anyNotRest = false
      chord.forEach(sourceEvent => {
        let isRest = sourceEvent.value === undefined
        if (!isRest) { anyNotRest = true }
        let event = {}
        event.value = sourceEvent.value
        event.idx = timingContext._isSingleStep ? timingContext._idx : timingContext._idx % timingContext._numDistinctTimes
        event._time = timingContext._patternCount - count
        event.dur = sourceEvent.dur * duration
        event.count = count + event._time
        if (!isRest) { // No point setting up loads of data on rests that will be discarded anyway
          event.sharp = sourceEvent.sharp
          event.loud = sourceEvent.loud
          event.long = sourceEvent.long
        }
        eventsForBeat.push(event)
      })
      let lastEvent = eventsForBeat[eventsForBeat.length-1]
      timingContext._patternCount += lastEvent.dur // Events in a chord are pre-sorted so shortest duration is last
      if (anyNotRest) { timingContext._idx++ }
    }
    return eventsForBeat
  }

  let stepToCountFast = (count, dur, events, timingContext) => {
    //!!Changes here must be mirrored in stepToCount and getNextChord!!
    // Should step through the same as stepToCount, but as quickly as possible
    while (timingContext._patternCount < count + 0.9999) {
      let duration = mainParam(evalParamFrame(dur, {idx: timingContext._idx, count: timingContext._patternCount}, count), 1)
      if (duration < 1/8) { return false } // Bomb out if there are very short durations, to avoid looping for ages
      let anyNotRest = false
      let lastDur = 1
      let event = getEvent(events, timingContext)
      let chordTime = event._time
      do {
        let isRest = event.value === undefined
        if (!isRest) { anyNotRest = true }
        lastDur = event.dur * duration
        if (nextEventMaybeLoop(events, timingContext)) { break }
        event = getEvent(events, timingContext)
      } while (event._time === chordTime)
      timingContext._patternCount += lastDur
      if (anyNotRest) { timingContext._idx++ }
    }
    return true
  }

  let initialiseTimingContext = (count, dur, events, timingContext) => {
    // Pattern summary info
    let nonRestEvents = events.filter(e => e.value !== undefined)
    let numDistinctTimes = new Set(nonRestEvents.map(e => e._time)).size
    let isSingleStep = numDistinctTimes === 1
    timingContext._isSingleStep = isSingleStep
    timingContext._numDistinctTimes = numDistinctTimes
    if (events.length === 1 && !Number.isNaN(dur) ) {
      // Complex dur for single step pattern; initialise timing context by stepping through from time 0; accurate but slow
      timingContext._patternIdx = 0
      timingContext._subPatternIdx = 0
      timingContext._idx = 0
      timingContext._patternRepeats = 0
      timingContext._patternCount = 0
      if (stepToCountFast(count-1, dur, events, timingContext)) {
        return
      }
    } else {
      // For known length patterns, initialise timing context as if we're at the beginning of the current repeat of the pattern, then step through to current count
      let patternLength = calculatePatternLength(dur, events)
      let patternRepeats = Math.floor(count / patternLength)
      timingContext._patternIdx = 0
      timingContext._subPatternIdx = 0
      timingContext._idx = isSingleStep ? patternRepeats : 0
      timingContext._patternRepeats = patternRepeats
      timingContext._patternCount = patternLength * patternRepeats
      if (stepToCountFast(count-1, dur, events, timingContext)) {
        return
      }
    }
    // Fallback: default TC init as if the pattern length is one
    timingContext._patternIdx = 0
    timingContext._subPatternIdx = 0
    timingContext._idx = count-1
    timingContext._patternRepeats = count-1
    timingContext._patternCount = count-1
  }

  let parsePattern = (patternStr, params) => {
    if (!patternStr) { return () => [] }
    let pattern = parsePatternLiteral(patternStr)
    let events = pattern.events
    if (events.length == 0) { return () => [] }
    let dur = param(params.dur, 1)
    let durString = typeof dur === 'function' ? dur._durParamString : dur.toString()
    return (count, timingContext) => {
      let tcNotInitialised = timingContext._patternIdx === undefined
      let patternChanged = timingContext._patternString !== patternStr
      let durChanged = timingContext._durParamString !== durString
      let patternIdxOutsideRange = timingContext._patternIdx >= events.length
      if (tcNotInitialised || patternChanged || patternIdxOutsideRange || durChanged) {
        initialiseTimingContext(count, dur, events, timingContext)
        timingContext._patternString = patternStr
        timingContext._durParamString = durString
      }
      let eventsForBeat = stepToCount(count, dur, events, timingContext)
                            .filter(({value}) => value !== undefined) // Discard rests
      eventsForBeat.forEach(event => {
        for (let k in params) {
          if (k != '_time' && k != 'value' && k != 'dur') {
            event[k] = params[k]
          }
        }
      })
      return eventsForBeat
    }
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual, msg) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`+(!!msg?'\n'+msg:'')) }
  }

  let pattern, tc

  tc = {}
  pattern = parsePattern('', {})
  assert([], pattern(0, tc))
  assert([], pattern(1, tc))

  tc = {}
  pattern = parsePattern('.', {})
  assert([], pattern(0, tc))
  assert([], pattern(1, tc))

  pattern = parsePattern('1234', {})
  tc = {}
  assert([{value:1,idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  tc = {}
  assert([{value:2,idx:1,_time:0,dur:1,count:1}], pattern(1, tc))
  tc = {}
  assert([{value:3,idx:2,_time:0,dur:1,count:2}], pattern(2, tc))
  tc = {}
  assert([{value:4,idx:3,_time:0,dur:1,count:3}], pattern(3, tc))
  tc = {}
  assert([{value:1,idx:0,_time:0,dur:1,count:4}], pattern(4, tc))

  pattern = parsePattern('<1234>', {})
  tc = {}
  assert([{value:3,idx:2,_time:0,dur:1,count:2}], pattern(2, tc))

  pattern = parsePattern('[1234]', {dur:4})
  tc = {}
  assert([{value:3,idx:2,_time:0,dur:1,count:2}], pattern(2, tc))

  pattern = parsePattern('1___2___3___4___', {dur:1/4})
  tc = {}
  assert([{value:3,idx:2,_time:0,dur:1,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('0', {})
  assert([{value:0,idx:3,_time:0,dur:1,count:3}], pattern(3, tc))
  assert([{value:0,idx:4,_time:0,dur:1,count:4}], pattern(4, tc))

  pattern = parsePattern('<1[23]>', {dur:2})
  tc = {}
  assert([{value:3,idx:2,_time:0,dur:1,count:3}], pattern(3, tc))
  assert([{value:1,idx:3,_time:0,dur:2,count:4}], pattern(4, tc))

  tc = {}
  pattern = parsePattern('0', {})
  assert([{value:0,idx:8,_time:0,dur:1,count:8}], pattern(8, tc))
  assert([{value:0,idx:9,_time:0,dur:1,count:9}], pattern(9, tc))

  tc = {}
  pattern = parsePattern('0', {dur:2})
  assert([], pattern(3, tc))
  assert([{value:0,idx:2,_time:0,dur:2,count:4}], pattern(4, tc))

  tc = {}
  pattern = parsePattern('0_', {})
  assert([], pattern(3, tc))
  assert([{value:0,idx:2,_time:0,dur:2,count:4}], pattern(4, tc))

  tc = {}
  pattern = parsePattern('0_1_', {})
  assert([], pattern(5, tc))
  assert([{value:1,idx:1,_time:0,dur:2,count:6}], pattern(6, tc))
  assert([], pattern(7, tc))
  assert([{value:0,idx:0,_time:0,dur:2,count:8}], pattern(8, tc))

  tc = {}
  pattern = parsePattern('01', {dur:2})
  assert([], pattern(5, tc))
  assert([{value:1,idx:1,_time:0,dur:2,count:6}], pattern(6, tc))
  assert([], pattern(7, tc))
  assert([{value:0,idx:0,_time:0,dur:2,count:8}], pattern(8, tc))

  tc = {}
  pattern = parsePattern('0', {dur:({idx})=>{ return {value:idx%2?3:1,_repeatCount:2}}})
  assert([{value:0,idx:3,_time:0,dur:3,count:5}], pattern(5, tc))
  assert([], pattern(6, tc))
  assert([], pattern(7, tc))
  assert([{value:0,idx:4,_time:0,dur:1,count:8}], pattern(8, tc))

  tc = {}
  pattern = parsePattern('0', {dur:({idx})=>{ return {value:idx%2?3:1,_repeatCount:2}}})
  assert([], pattern(6, tc))
  assert([], pattern(7, tc))
  assert([{value:0,idx:4,_time:0,dur:1,count:8}], pattern(8, tc))
  assert([{value:0,idx:5,_time:0,dur:3,count:9}], pattern(9, tc))

  // // Test for checking the max time to step through patterns for TC init
  // tc = {}
  // pattern = parsePattern('0', {dur:()=>1/8})
  // let n = 200000 // 100000 beats * 100 players at once; assumed worst case
  // console.time('test')
  // pattern(n, tc)
  // console.timeEnd('test') // Expect this to take a little while; eg 100ms as TC init will count up from 0

  // // Test for checking the max time to step through patterns for TC init
  // tc = {}
  // pattern = parsePattern('0', {dur:()=>1/80}) // granular might use 1/80 duration
  // let n = 200000 // 100000 beats * 20 granular players at once; assumed worst case
  // console.time('test')
  // pattern(n, tc)
  // console.timeEnd('test') // Expect this to be very quick as it will bomb out of the TC init count from 0 due to very short duration

  tc = {}
  pattern = parsePattern('x', {})
  assert([{value:'x',idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([{value:'x',idx:1,_time:0,dur:1,count:1}], pattern(1, tc))
  assert([{value:'x',idx:2,_time:0,dur:1,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('x', {dur:()=>1})
  assert([{value:'x',idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([{value:'x',idx:1,_time:0,dur:1,count:1}], pattern(1, tc))
  assert([{value:'x',idx:2,_time:0,dur:1,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('xo', {})
  assert([{value:'x',idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([{value:'o',idx:1,_time:0,dur:1,count:1}], pattern(1, tc))
  assert([{value:'x',idx:0,_time:0,dur:1,count:2}], pattern(2, tc))
  assert([{value:'o',idx:1,_time:0,dur:1,count:3}], pattern(3, tc))

  tc = {}
  pattern = parsePattern('xo', {dur:1/2})
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:0},{value:'o',idx:1,_time:1/2,dur:1/2,count:0.5}], pattern(0, tc))
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:1},{value:'o',idx:1,_time:1/2,dur:1/2,count:1.5}], pattern(1, tc))

  tc = {}
  pattern = parsePattern('xo', {dur:()=>1/2})
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:0},{value:'o',idx:1,_time:1/2,dur:1/2,count:0.5}], pattern(0, tc))
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:1},{value:'o',idx:1,_time:1/2,dur:1/2,count:1.5}], pattern(1, tc))
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:2},{value:'o',idx:1,_time:1/2,dur:1/2,count:2.5}], pattern(2, tc))
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:3},{value:'o',idx:1,_time:1/2,dur:1/2,count:3.5}], pattern(3, tc))

  tc = {}
  pattern = parsePattern('xo', {dur:({idx})=> idx%2 ? 1/4 : 3/4})
  assert([{value:'x',idx:0,_time:0,dur:3/4,count:0},{value:'o',idx:1,_time:3/4,dur:1/4,count:3/4}], pattern(0, tc))
  assert([{value:'x',idx:0,_time:0,dur:3/4,count:1},{value:'o',idx:1,_time:3/4,dur:1/4,count:7/4}], pattern(1, tc))
  assert([{value:'x',idx:0,_time:0,dur:3/4,count:2},{value:'o',idx:1,_time:3/4,dur:1/4,count:11/4}], pattern(2, tc))
  assert([{value:'x',idx:0,_time:0,dur:3/4,count:3},{value:'o',idx:1,_time:3/4,dur:1/4,count:15/4}], pattern(3, tc))

  tc = {}
  pattern = parsePattern('xo', {dur:({idx})=> idx%2 ? 1/4 : 1})
  assert([{value:'x',idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([{value:'o',idx:1,_time:0,dur:1/4,count:1},{value:'x',idx:0,_time:1/4,dur:1,count:5/4}], pattern(1, tc))
  assert([{value:'o',idx:1,_time:1/4,dur:1/4,count:9/4},{value:'x',idx:0,_time:1/2,dur:1,count:10/4}], pattern(2, tc))
  assert([{value:'o',idx:1,_time:1/2,dur:1/4,count:14/4},{value:'x',idx:0,_time:3/4,dur:1,count:15/4}], pattern(3, tc))
  assert([{value:'o',idx:1,_time:3/4,dur:1/4,count:19/4}], pattern(4, tc))
  assert([{value:'x',idx:0,_time:0,dur:1,count:20/4}], pattern(5, tc))

  tc = {}
  pattern = parsePattern('x[--]', {dur:()=>1/2})
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:0},{value:'-',idx:1,_time:1/2,dur:1/4,count:1/2},{value:'-',idx:2,_time:3/4,dur:1/4,count:3/4}], pattern(0, tc))
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:1},{value:'-',idx:1,_time:1/2,dur:1/4,count:3/2},{value:'-',idx:2,_time:3/4,dur:1/4,count:7/4}], pattern(1, tc))

  tc = {}
  pattern = parsePattern('x', {dur:({count})=>count+1})
  assert([{value:'x',idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([{value:'x',idx:1,_time:0,dur:2,count:1}], pattern(1, tc))
  assert([], pattern(2, tc))
  assert([{value:'x',idx:2,_time:0,dur:4,count:3}], pattern(3, tc))

  tc = {}
  pattern = parsePattern('x', {dur:({idx})=>[3/4,3/4,2/4][idx % 3]})
  assert([{value:'x',idx:0,_time:0,dur:3/4,count:0},{value:'x',idx:1,_time:3/4,dur:3/4,count:3/4}], pattern(0, tc))
  assert([{value:'x',idx:2,_time:1/2,dur:2/4,count:3/2}], pattern(1, tc))

  tc = {}
  pattern = parsePattern('-', {dur:1/4})
  assert([{value:'-',idx:0,_time:0,dur:1/4,count:0},{value:'-',idx:1,_time:1/4,dur:1/4,count:1/4},{value:'-',idx:2,_time:2/4,dur:1/4,count:2/4},{value:'-',idx:3,_time:3/4,dur:1/4,count:3/4}], pattern(0, tc))
  assert([{value:'-',idx:4,_time:0,dur:1/4,count:1},{value:'-',idx:5,_time:1/4,dur:1/4,count:5/4},{value:'-',idx:6,_time:2/4,dur:1/4,count:6/4},{value:'-',idx:7,_time:3/4,dur:1/4,count:7/4}], pattern(1, tc))

  tc = {}
  pattern = parsePattern('-', {dur:4/5})
  assert([{value:'-',idx:0,_time:0,dur:4/5,count:0},{value:'-',idx:1,_time:4/5,dur:4/5,count:4/5}], pattern(0, tc))
  assert([{value:'-',idx:2,_time:3/5,dur:4/5,count:8/5}], pattern(1, tc))
  assert([{value:'-',idx:3,_time:2/5,dur:4/5,count:12/5}], pattern(2, tc))
  assert([{value:'-',idx:4,_time:1/5,dur:4/5,count:16/5}], pattern(3, tc))
  assert([{value:'-',idx:5,_time:0,dur:4/5,count:4},{value:'-',idx:6,_time:4/5,dur:4/5,count:24/5}], pattern(4, tc))
  assert([{value:'-',idx:7,_time:3/5,dur:4/5,count:28/5}], pattern(5, tc))

  tc = {}
  pattern = parsePattern('xo', {dur:2})
  assert([{value:'x',idx:0,_time:0,dur:2,count:0}], pattern(0, tc))
  assert([], pattern(1, tc))
  assert([{value:'o',idx:1,_time:0,dur:2,count:2}], pattern(2, tc))
  assert([], pattern(3, tc))
  assert([{value:'x',idx:0,_time:0,dur:2,count:4}], pattern(4, tc))

  tc = {}
  pattern = parsePattern('xo', {dur:3/2})
  assert([{value:'x',idx:0,_time:0,dur:3/2,count:0}], pattern(0, tc))
  assert([{value:'o',idx:1,_time:1/2,dur:3/2,count:3/2}], pattern(1, tc))
  assert([], pattern(2, tc))
  assert([{value:'x',idx:0,_time:0,dur:3/2,count:3}], pattern(3, tc))

  tc = {}
  pattern = parsePattern('xo', {dur:3})
  assert([{value:'x',idx:0,_time:0,dur:3,count:0}], pattern(0, tc))
  assert([], pattern(1, tc))
  assert([], pattern(2, tc))
  assert([{value:'o',idx:1,_time:0,dur:3,count:3}], pattern(3, tc))
  assert([], pattern(4, tc))
  assert([], pattern(5, tc))
  assert([{value:'x',idx:0,_time:0,dur:3,count:6}], pattern(6, tc))

  tc = {}
  pattern = parsePattern('xo', {dur:2.5})
  assert([{value:'x',idx:0,_time:0,dur:2.5,count:0}], pattern(0, tc))
  assert([], pattern(1, tc))
  assert([{value:'o',idx:1,_time:0.5,dur:2.5,count:2.5}], pattern(2, tc))
  assert([], pattern(3, tc))
  assert([], pattern(4, tc))
  assert([{value:'x',idx:0,_time:0,dur:2.5,count:5}], pattern(5, tc))

  tc = {}
  pattern = parsePattern('.-', {dur:1/2})
  assert([{value:'-',idx:0,_time:1/2,dur:1/2,count:1/2}], pattern(0, tc))
  assert([{value:'-',idx:1,_time:1/2,dur:1/2,count:3/2}], pattern(1, tc))
  assert([{value:'-',idx:2,_time:1/2,dur:1/2,count:5/2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('=--.--', {dur:1/3})
  assert([{value:'=',idx:0,_time:0,dur:1/3,count:0},{value:'-',idx:1,_time:1/3,dur:1/3,count:1/3},{value:'-',idx:2,_time:2/3,dur:1/3,count:2/3}], pattern(0, tc))
  assert([{value:'-',idx:3,_time:1/3,dur:1/3,count:4/3},{value:'-',idx:4,_time:2/3,dur:1/3,count:5/3}], pattern(1, tc))
  assert([{value:'=',idx:0,_time:0,dur:1/3,count:6/3},{value:'-',idx:1,_time:1/3,dur:1/3,count:7/3},{value:'-',idx:2,_time:2/3,dur:1/3,count:8/3}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('[xo]', {})
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:0},{value:'o',idx:1,_time:1/2,dur:1/2,count:1/2}], pattern(0, tc))
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:1},{value:'o',idx:1,_time:1/2,dur:1/2,count:3/2}], pattern(1, tc))

  tc = {}
  pattern = parsePattern('[---]', {})
  assert([{value:'-',idx:0,_time:0,dur:1/3,count:0},{value:'-',idx:1,_time:1/3,dur:1/3,count:1/3},{value:'-',idx:2,_time:2/3,dur:1/3,count:2/3}], pattern(0, tc))
  assert([{value:'-',idx:0,_time:0,dur:1/3,count:1},{value:'-',idx:1,_time:1/3,dur:1/3,count:4/3},{value:'-',idx:2,_time:2/3,dur:1/3,count:5/3}], pattern(1, tc))

  tc = {}
  pattern = parsePattern('[--[--]-]', {})
  assert([{value:'-',idx:0,_time:0,dur:1/4,count:0},{value:'-',idx:1,_time:1/4,dur:1/4,count:1/4},{value:'-',idx:2,_time:1/2,dur:1/8,count:1/2},{value:'-',idx:3,_time:5/8,dur:1/8,count:5/8},{value:'-',idx:4,_time:3/4,dur:1/4,count:3/4}], pattern(0, tc))
  assert([{value:'-',idx:0,_time:0,dur:1/4,count:1},{value:'-',idx:1,_time:1/4,dur:1/4,count:5/4},{value:'-',idx:2,_time:1/2,dur:1/8,count:3/2},{value:'-',idx:3,_time:5/8,dur:1/8,count:13/8},{value:'-',idx:4,_time:3/4,dur:1/4,count:7/4}], pattern(1, tc))

  tc = {}
  pattern = parsePattern('[xo]', {dur:1/2})
  assert([{value:'x',idx:0,_time:0,dur:1/4,count:0},{value:'o',idx:1,_time:1/4,dur:1/4,count:1/4},{value:'x',idx:0,_time:1/2,dur:1/4,count:2/4},{value:'o',idx:1,_time:3/4,dur:1/4,count:3/4}], pattern(0, tc))
  assert([{value:'x',idx:0,_time:0,dur:1/4,count:1},{value:'o',idx:1,_time:1/4,dur:1/4,count:5/4},{value:'x',idx:0,_time:1/2,dur:1/4,count:6/4},{value:'o',idx:1,_time:3/4,dur:1/4,count:7/4}], pattern(1, tc))

  tc = {}
  pattern = parsePattern('[xo].', {dur:1/2})
  assert([{value:'x',idx:0,_time:0,dur:1/4,count:0},{value:'o',idx:1,_time:1/4,dur:1/4,count:1/4}], pattern(0, tc))
  assert([{value:'x',idx:0,_time:0,dur:1/4,count:1},{value:'o',idx:1,_time:1/4,dur:1/4,count:5/4}], pattern(1, tc))

  tc = {}
  pattern = parsePattern('0_', {})
  assert([{value:0,idx:0,_time:0,dur:2,count:0}], pattern(0, tc))
  assert([], pattern(1, tc))
  assert([{value:0,idx:1,_time:0,dur:2,count:2}], pattern(2, tc))
  assert([], pattern(3, tc))

  tc = {}
  pattern = parsePattern('012345', {dur:2})
  for (let i = 0; i < 20; i++) {
    assert([{value:(i%6),idx:(i%6),_time:0,dur:2,count:2*i}], pattern(2*i, tc), `Iteration: ${i}`)
    assert([], pattern(2*i+1, tc), `Iteration: ${i}`)
  }

  tc = {}
  pattern = parsePattern('012345', {dur:()=>2})
  for (let i = 0; i < 20; i++) {
    assert([{value:(i%6),idx:(i%6),_time:0,dur:2,count:2*i}], pattern(2*i, tc), `Iteration: ${i}`)
    assert([], pattern(2*i+1, tc), `Iteration: ${i}`)
  }

  tc = {}
  pattern = parsePattern('0-1-2-x1', {})
  assert([{value:0,idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([{value:-1,idx:1,_time:0,dur:1,count:1}], pattern(1, tc))
  assert([{value:-2,idx:2,_time:0,dur:1,count:2}], pattern(2, tc))
  assert([{value:'-',idx:3,_time:0,dur:1,count:3}], pattern(3, tc))
  assert([{value:'x',idx:4,_time:0,dur:1,count:4}], pattern(4, tc))
  assert([{value:1,idx:5,_time:0,dur:1,count:5}], pattern(5, tc))

  tc = {}
  pattern = parsePattern('0', {amp:2})
  assert([{value:0,idx:0,_time:0,dur:1,count:0,amp:2}], pattern(0, tc))

  tc = {}
  pattern = parsePattern('0', {delay:1/2})
  assert([{value:0,idx:0,_time:0,dur:1,count:0,delay:1/2}], pattern(0, tc))

  tc = {}
  pattern = parsePattern('0', {amp:[2,3]})
  assert([{value:0,idx:0,_time:0,dur:1,count:0,amp:[2,3]}], pattern(0, tc))
  assert([{value:0,idx:1,_time:0,dur:1,count:1,amp:[2,3]}], pattern(1, tc))

  tc = {}
  pattern = parsePattern('0_', {})
  assert([{value:0,idx:0,_time:0,dur:2,count:0}], pattern(0, tc))
  assert([], pattern(1, tc))
  assert([{value:0,idx:1,_time:0,dur:2,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('0.', {})
  assert([{value:0,idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([], pattern(1, tc))
  assert([{value:0,idx:1,_time:0,dur:1,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('.0', {})
  assert([], pattern(0, tc))
  assert([{value:0,idx:0,_time:0,dur:1,count:1}], pattern(1, tc))
  assert([], pattern(2, tc))
  assert([{value:0,idx:1,_time:0,dur:1,count:3}], pattern(3, tc))

  tc = {}
  pattern = parsePattern('0_', {dur:()=>1})
  assert([{value:0,idx:0,_time:0,dur:2,count:0}], pattern(0, tc))
  assert([], pattern(1, tc))
  assert([{value:0,idx:1,_time:0,dur:2,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('0.', {dur:()=>1})
  assert([{value:0,idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([], pattern(1, tc))
  assert([{value:0,idx:1,_time:0,dur:1,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('.0', {dur:()=>1})
  assert([], pattern(0, tc))
  assert([{value:0,idx:0,_time:0,dur:1,count:1}], pattern(1, tc))
  assert([], pattern(2, tc))
  assert([{value:0,idx:1,_time:0,dur:1,count:3}], pattern(3, tc))

  tc = {}
  pattern = parsePattern('0[_1]', {})
  assert([{value:0,idx:0,_time:0,dur:1.5,count:0}], pattern(0, tc))
  assert([{value:1,idx:1,_time:1/2,dur:1/2,count:3/2}], pattern(1, tc))
  assert([{value:0,idx:0,_time:0,dur:1.5,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('0[_1]', {dur:()=>1})
  assert([{value:0,idx:0,_time:0,dur:1.5,count:0}], pattern(0, tc))
  assert([{value:1,idx:1,_time:1/2,dur:1/2,count:3/2}], pattern(1, tc))
  assert([{value:0,idx:0,_time:0,dur:1.5,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('(xo)', {})
  assert([{value:'x',idx:0,_time:0,dur:1,count:0},{value:'o',idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([{value:'x',idx:1,_time:0,dur:1,count:1},{value:'o',idx:1,_time:0,dur:1,count:1}], pattern(1, tc))
  assert([{value:'x',idx:2,_time:0,dur:1,count:2},{value:'o',idx:2,_time:0,dur:1,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('(xo)', {dur:()=>1})
  assert([{value:'x',idx:0,_time:0,dur:1,count:0},{value:'o',idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([{value:'x',idx:1,_time:0,dur:1,count:1},{value:'o',idx:1,_time:0,dur:1,count:1}], pattern(1, tc))
  assert([{value:'x',idx:2,_time:0,dur:1,count:2},{value:'o',idx:2,_time:0,dur:1,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('(01)_', {})
  assert([{value:0,idx:0,_time:0,dur:2,count:0},{value:1,idx:0,_time:0,dur:2,count:0}], pattern(0, tc))
  assert([], pattern(1, tc))
  assert([{value:0,idx:1,_time:0,dur:2,count:2},{value:1,idx:1,_time:0,dur:2,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('(01)_', {dur:()=>1/2})
  assert([{value:0,idx:0,_time:0,dur:1,count:0},{value:1,idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([{value:0,idx:1,_time:0,dur:1,count:1},{value:1,idx:1,_time:0,dur:1,count:1}], pattern(1, tc))

  tc = {}
  pattern = parsePattern('.(01)', {})
  assert([], pattern(0, tc))
  assert([{value:0,idx:0,_time:0,dur:1,count:1},{value:1,idx:0,_time:0,dur:1,count:1}], pattern(1, tc))
  assert([], pattern(2, tc))
  assert([{value:0,idx:1,_time:0,dur:1,count:3},{value:1,idx:1,_time:0,dur:1,count:3}], pattern(3, tc))

  tc = {}
  pattern = parsePattern('.(01)', {dur:()=>1/2})
  assert([{value:0,idx:0,_time:1/2,dur:1/2,count:1/2},{value:1,idx:0,_time:1/2,dur:1/2,count:1/2}], pattern(0, tc))
  assert([{value:0,idx:1,_time:1/2,dur:1/2,count:3/2},{value:1,idx:1,_time:1/2,dur:1/2,count:3/2}], pattern(1, tc))

  tc = {}
  pattern = parsePattern('[.(24)]_', {})
  assert([{value:2,idx:0,_time:0.5,dur:1.5,count:1/2},{value:4,idx:0,_time:0.5,dur:1.5,count:1/2}], pattern(0, tc))
  assert([], pattern(1, tc))
  assert([{value:2,idx:1,_time:0.5,dur:1.5,count:5/2},{value:4,idx:1,_time:0.5,dur:1.5,count:5/2}], pattern(2, tc))
  
  tc = {}
  pattern = parsePattern('(o[--])', {})
  assert([{value:'o',idx:0,_time:0,dur:1,count:0},{value:'-',idx:0,_time:0,dur:0.5,count:0},{value:'-',idx:1,_time:0.5,dur:0.5,count:1/2}], pattern(0, tc))
  assert([{value:'o',idx:0,_time:0,dur:1,count:1},{value:'-',idx:0,_time:0,dur:0.5,count:1},{value:'-',idx:1,_time:0.5,dur:0.5,count:3/2}], pattern(1, tc))
  
  tc = {}
  pattern = parsePattern('x(o[--])', {})
  assert([{value:'x',idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([{value:'o',idx:1,_time:0,dur:1,count:1},{value:'-',idx:1,_time:0,dur:0.5,count:1},{value:'-',idx:2,_time:0.5,dur:0.5,count:3/2}], pattern(1, tc))
  assert([{value:'x',idx:0,_time:0,dur:1,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('([--]o)', {})
  assert([{value:'o',idx:0,_time:0,dur:1,count:0},{value:'-',idx:0,_time:0,dur:1/2,count:0},{value:'-',idx:1,_time:1/2,dur:1/2,count:1/2}], pattern(0, tc))
  assert([{value:'o',idx:0,_time:0,dur:1,count:1},{value:'-',idx:0,_time:0,dur:1/2,count:1},{value:'-',idx:1,_time:1/2,dur:1/2,count:3/2}], pattern(1, tc))

  tc = {}
  pattern = parsePattern('x([--]o)', {})
  assert([{value:'x',idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([{value:'o',idx:1,_time:0,dur:1,count:1},{value:'-',idx:1,_time:0,dur:1/2,count:1},{value:'-',idx:2,_time:0.5,dur:0.5,count:3/2}], pattern(1, tc))
  assert([{value:'x',idx:0,_time:0,dur:1,count:2}], pattern(2, tc))
  
  tc = {}
  pattern = parsePattern('x(o[--])', {dur:()=>1/2})
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:0},{value:'o',idx:1,_time:1/2,dur:1/2,count:1/2},{value:'-',idx:1,_time:1/2,dur:1/4,count:1/2},{value:'-',idx:2,_time:3/4,dur:1/4,count:3/4}], pattern(0, tc))
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:1},{value:'o',idx:1,_time:1/2,dur:1/2,count:3/2},{value:'-',idx:1,_time:1/2,dur:1/4,count:3/2},{value:'-',idx:2,_time:3/4,dur:1/4,count:7/4}], pattern(1, tc))
  
  tc = {}
  pattern = parsePattern('x([--]o)', {dur:()=>1/2})
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:0},{value:'o',idx:1,_time:1/2,dur:1/2,count:1/2},{value:'-',idx:1,_time:1/2,dur:1/4,count:1/2},{value:'-',idx:2,_time:3/4,dur:1/4,count:3/4}], pattern(0, tc))
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:1},{value:'o',idx:1,_time:1/2,dur:1/2,count:3/2},{value:'-',idx:1,_time:1/2,dur:1/4,count:3/2},{value:'-',idx:2,_time:3/4,dur:1/4,count:7/4}], pattern(1, tc))

  tc = {}
  pattern = parsePattern('<01>', {})
  assert([{value:0,idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([{value:1,idx:1,_time:0,dur:1,count:1}], pattern(1, tc))
  assert([{value:0,idx:2,_time:0,dur:1,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('<01><345>', {dur:1/2})
  assert([{value:0,idx:0,_time:0,dur:1/2,count:0},{value:3,idx:1,_time:1/2,dur:1/2,count:1/2}], pattern(0, tc))
  assert([{value:1,idx:0,_time:0,dur:1/2,count:1},{value:4,idx:1,_time:1/2,dur:1/2,count:3/2}], pattern(1, tc))
  assert([{value:0,idx:0,_time:0,dur:1/2,count:2},{value:5,idx:1,_time:1/2,dur:1/2,count:5/2}], pattern(2, tc))
  assert([{value:1,idx:0,_time:0,dur:1/2,count:3},{value:3,idx:1,_time:1/2,dur:1/2,count:7/2}], pattern(3, tc))

  tc = {}
  pattern = parsePattern('<01>', {dur:()=>1})
  assert([{value:0,idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([{value:1,idx:1,_time:0,dur:1,count:1}], pattern(1, tc))
  assert([{value:0,idx:2,_time:0,dur:1,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('<01><345>', {dur:()=>1/2})
  assert([{value:0,idx:0,_time:0,dur:1/2,count:0},{value:3,idx:1,_time:1/2,dur:1/2,count:1/2}], pattern(0, tc))
  assert([{value:1,idx:0,_time:0,dur:1/2,count:1},{value:4,idx:1,_time:1/2,dur:1/2,count:3/2}], pattern(1, tc))
  assert([{value:0,idx:0,_time:0,dur:1/2,count:2},{value:5,idx:1,_time:1/2,dur:1/2,count:5/2}], pattern(2, tc))
  assert([{value:1,idx:0,_time:0,dur:1/2,count:3},{value:3,idx:1,_time:1/2,dur:1/2,count:7/2}], pattern(3, tc))

  tc = {}
  pattern = parsePattern('<1[23]>', {})
  assert([{value:1,idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([{value:2,idx:1,_time:0,dur:1/2,count:1},{value:3,idx:2,_time:1/2,dur:1/2,count:3/2}], pattern(1, tc))
  assert([{value:1,idx:3,_time:0,dur:1,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('<1[23]>', {dur:()=>1})
  assert([{value:1,idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([{value:2,idx:1,_time:0,dur:1/2,count:1},{value:3,idx:2,_time:1/2,dur:1/2,count:3/2}], pattern(1, tc))
  assert([{value:1,idx:3,_time:0,dur:1,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('<1[23]>', {dur:1/2})
  assert([{value:1,idx:0,_time:0,dur:1/2,count:0},{value:2,idx:1,_time:1/2,dur:1/4,count:1/2},{value:3,idx:2,_time:3/4,dur:1/4,count:3/4}], pattern(0, tc))
  assert([{value:1,idx:3,_time:0,dur:1/2,count:1},{value:2,idx:4,_time:1/2,dur:1/4,count:3/2},{value:3,idx:5,_time:3/4,dur:1/4,count:7/4}], pattern(1, tc))
   // idx should really be 0,1,2 again the second time through but hey.

  tc = {}
  pattern = parsePattern('<1(23)>', {})
  assert([{value:1,idx:0,_time:0,dur:1,count:0}], pattern(0, tc))
  assert([{value:2,idx:1,_time:0,dur:1,count:1},{value:3,idx:1,_time:0,dur:1,count:1}], pattern(1, tc))
  assert([{value:1,idx:2,_time:0,dur:1,count:2}], pattern(2, tc))

  tc = {}
  pattern = parsePattern('0', {dur:()=>{ return {value:1}}})
  assert([{value:0,idx:4,_time:0,dur:1,count:4}], pattern(4, tc))
  assert([{value:0,idx:5,_time:0,dur:1,count:5}], pattern(5, tc))

  tc = {}
  pattern = parsePattern('01', {dur:()=>{ return {value:1}}})
  assert([{value:0,idx:0,_time:0,dur:1,count:4}], pattern(4, tc))
  assert([{value:1,idx:1,_time:0,dur:1,count:5}], pattern(5, tc))

  let evalPerFrame = ()=>1
  evalPerFrame.interval = 'frame'
  assert(1, parsePattern('0', {scroll:evalPerFrame})(0, {})[0].scroll())

  pattern = parsePattern('0#', {dur:1})
  assert([{value:0,idx:0,_time:0,dur:1,count:0,sharp:1}], pattern(0, {}))

  pattern = parsePattern('0b', {dur:1})
  assert([{value:0,idx:0,_time:0,dur:1,count:0,sharp:-1}], pattern(0, {}))

  pattern = parsePattern('0^', {dur:1})
  assert([{value:0,idx:0,_time:0,dur:1,count:0,loud:3/2}], pattern(0, {}))

  pattern = parsePattern('0v', {dur:1})
  assert([{value:0,idx:0,_time:0,dur:1,count:0,loud:1/2}], pattern(0, {}))

  pattern = parsePattern('0=', {dur:1})
  assert([{value:0,idx:0,_time:0,dur:1,count:0,long:2}], pattern(0, {}))

  pattern = parsePattern('0!', {dur:1})
  assert([{value:0,idx:0,_time:0,dur:1,count:0,long:1/2}], pattern(0, {}))

  console.log("Pattern tests complete")
  }
  
  return parsePattern
});
