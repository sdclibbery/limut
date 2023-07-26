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
    tc.numNonRests = 0
    let numSteps = 0
    do {
      let duration = mainParam(evalParamFrame(dur, {idx: idx, count: count}, count), 1)
      if (duration <= 0) { throw 'Zero duration' }
      step = pattern.next()
      if (step !== undefined) {
        let e = (step.toSorted((a,b) => a.dur - b.dur))[0] // Get shortest event
        if (e.value !== undefined) {
          tc.numNonRests++
          idx++
        }
        count += duration * e.dur
      }
      numSteps++
      if (numSteps > 128) { // If the pattern is crazy long, act as if its a single stepper
        tc.patternLength = 1
        return
      }
    } while (step !== undefined)
    tc.patternLength = count
  }

  let toPreviousStart = (pattern, count, dur, tc) => {
    tc.patternCount = 0
    tc.idx = 0
    calculatePatternInfo(pattern, dur, tc)
    if (tc.patternLength === 1 && !Number.isNaN(dur)) { // Single step with complex dur: init by counting up from zero. Slow but accurate for this case
      pattern.reset(0)
      return // Return and allow the stepToCount in initTimingContext to step through from zero
    }
    let numTimesLooped = Math.trunc(count / tc.patternLength)
    pattern.reset(numTimesLooped)
    tc.patternCount = tc.patternLength * numTimesLooped
    if (tc.numNonRests <= 1) { // Only one actual event in the pattern; init idx for a single step pattern
      tc.idx = numTimesLooped
    }
  }

  let initTimingContext = (tc, count, pattern, dur) => {
    pattern.reset(0)
    tc.idx = 0
    if (count === 0) { // At count 0; must be starting at the start of the pattern :-)
      calculatePatternInfo(pattern, dur, tc)
      pattern.reset(0)
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
        pattern.loop() // Loop pattern back to start
        if (tc.numNonRests > 1) {
          tc.idx = 0 // Reset idx, but only if multistep pattern
        }
        chord = pattern.next()
      }
      let anyNotRest = false
      chord
      .toSorted((a,b) => b.dur - a.dur)
      .forEach(sourceEvent => {
        let isRest = sourceEvent.value === undefined
        if (!isRest) { anyNotRest = true }
        let event = {}
        event.value = sourceEvent.value
        if (typeof event.value === 'function') {
          event.value = event.value(tc)
        }
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
      tc.patternCount += lastEvent.dur // Events are sorted so shortest duration is last
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
              .map(event => {
                for (let k in params) {
                  if (k != '_time' && k != 'value' && k != 'dur') {
                    event[k] = params[k]
                  }
                }
                return event
              })
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
      for (let i=0; i<30; i++) {
        assert(a(i), b(i), `i: ${i}`)
      }
    }
    let clearIdx = e => { delete e.idx; return e }
    let assertSameRootPatternWithDurs = (as, bs) => {
      let idxDur = ({idx}) => [3/4,3/4,2/4][idx % 3]
      let countDur = ({count}) => count+1
      let subParamDur = ()=>{ return {value: ()=>1 }}
      [0.3,1/3,2/3,1,3/2,3,idxDur,countDur,subParamDur].forEach(dur => {
        let a = root(as, {dur:dur})
        let b = root(bs, {dur:dur})
        for (let i=0; i<30; i++) {
          assert(a(i), b(i), `dur: ${dur}; i: ${i}`)
        }
      })
    }
    let assertSamePatternIgnoringIdx = (a, b) => {
      for (let i=0; i<30; i++) {
        assert(
          a(i).map(clearIdx), // Remove idx fields from both sides before comparison
          b(i).map(clearIdx),
          `i: ${i}`
        )
      }
    }
    let byCount = (a,b) => a.count - b.count
    let assertSameAsParallel = (a, b, c) => {
      for (let i=0; i<30; i++) {
        let combined = b(i).concat(c(i))
        assert(
          combined.map(clearIdx).sort(byCount),
          a(i).map(clearIdx).sort(byCount),
          `i: ${i}`)
      }
    }
    let assertSameWhenStartLater = (pc) => {
      let a = pc() // Create the base pattern once and step through
      for (let i=0; i<30; i++) {
        assert(a(i), pc()(i), `i: ${i}`) // Create the comparison pattern every time
      }
    }
    let p

    p = root('0', {})
    assert([{value:0,dur:1,_time:0,count:0,idx:0}], p(0))
    assert([{value:0,dur:1,_time:0,count:1,idx:1}], p(1))
    assert([{value:0,dur:1,_time:0,count:2,idx:2}], p(2))

    p = root('0', {amp:3})
    assert([{value:0,dur:1,_time:0,count:0,idx:0, amp:3}], p(0))

    p = root('01', {})
    assert([{value:0,dur:1,_time:0,count:0,idx:0}], p(0))
    assert([{value:1,dur:1,_time:0,count:1,idx:1}], p(1))
    assert([{value:0,dur:1,_time:0,count:2,idx:0}], p(2))
    assert([{value:1,dur:1,_time:0,count:3,idx:1}], p(3))

    p = root('0.1', {})
    assert([{value:0,dur:1,_time:0,count:0,idx:0}], p(0))
    assert([], p(1))
    assert([{value:1,dur:1,_time:0,count:2,idx:1}], p(2))

    p = root('01.2', {dur:1/2})
    assert([{value:0,dur:1/2,_time:0,count:0,idx:0},{value:1,dur:1/2,_time:1/2,count:1/2,idx:1}], p(0))
    assert([{value:2,dur:1/2,_time:1/2,count:3/2,idx:2}], p(1))

    p = root('01.2', {dur:1/4})
    assert([{value:0,dur:1/4,_time:0,count:0,idx:0},{value:1,dur:1/4,_time:1/4,count:1/4,idx:1},{value:2,dur:1/4,_time:3/4,count:3/4,idx:2}], p(0))
    assert([{value:0,dur:1/4,_time:0,count:1,idx:0},{value:1,dur:1/4,_time:1/4,count:5/4,idx:1},{value:2,dur:1/4,_time:3/4,count:7/4,idx:2}], p(1))

    p = root('01', {dur:2})
    assert([{value:0,dur:2,_time:0,count:0,idx:0}], p(0))
    assert([], p(1))
    assert([{value:1,dur:2,_time:0,count:2,idx:1}], p(2))
    assert([], p(3))
    assert([{value:0,dur:2,_time:0,count:4,idx:0}], p(4))

    p = root('01', {dur:2.5})
    assert([{value:0,dur:2.5,_time:0,count:0,idx:0}], p(0))
    assert([], p(1))
    assert([{value:1,dur:2.5,_time:1/2,count:2.5,idx:1}], p(2))
    assert([], p(3))
    assert([], p(4))
    assert([{value:0,dur:2.5,_time:0,count:5,idx:0}], p(5))

    p = root('0[12]', {})
    assert([{value:0,dur:1,_time:0,count:0,idx:0}], p(0))
    assert([{value:1,dur:1/2,_time:0,count:1,idx:1},{value:2,dur:1/2,_time:1/2,count:3/2,idx:2}], p(1))
    assert([{value:0,dur:1,_time:0,count:2,idx:0}], p(2))

    p = root('0', {})
    assert([{value:0,dur:1,_time:0,count:2,idx:2}], p(2)) // Start at count 2
    assert([{value:0,dur:1,_time:0,count:3,idx:3}], p(3))

    p = root('0123', {})
    assert([{value:2,dur:1,_time:0,count:2,idx:2}], p(2)) // Start at count 2
    assert([{value:3,dur:1,_time:0,count:3,idx:3}], p(3))
    assert([{value:0,dur:1,_time:0,count:4,idx:0}], p(4))

    p = root('0123', {dur:1/2})
    assert([{value:2,dur:1/2,_time:0,count:1,idx:2},{value:3,dur:1/2,_time:1/2,count:3/2,idx:3}], p(1)) // Start at 1
    assert([{value:0,dur:1/2,_time:0,count:2,idx:0},{value:1,dur:1/2,_time:1/2,count:5/2,idx:1}], p(2))

    p = root('01', {dur:2})
    assert([], p(1)) // Start at 1
    assert([{value:1,dur:2,_time:0,count:2,idx:1}], p(2))

    p = root('01', {dur:()=>1})
    assert([{value:1,dur:1,_time:0,count:1,idx:1}], p(1)) // Start at 1
    assert([{value:0,dur:1,_time:0,count:2,idx:0}], p(2))

    p = root('012'.repeat(128), {}) // Very long string
    assert([{value:1,dur:1,_time:0,count:1,idx:1}], p(1)) // Start at 1
    assert([{value:2,dur:1,_time:0,count:2,idx:2}], p(2))
    assert([{value:0,dur:1,_time:0,count:3,idx:3}], p(3)) // As if its a single step pattern

    p = root('0', {dur:({idx})=>{ return {value:idx%2 ? 3 : 1}}}) // idx based duration
    assert([{value:0,dur:1,_time:0,count:0,idx:0}], p(0))
    assert([{value:0,dur:3,_time:0,count:1,idx:1}], p(1))
    assert([], p(2))
    assert([], p(3))
    assert([{value:0,dur:1,_time:0,count:4,idx:2}], p(4))
  
    p = root('0', {dur:({idx})=>{ return {value:idx%2 ? 3 : 1}}})
    assert([{value:0,dur:1,_time:0,count:4,idx:2}], p(4))
    assert([{value:0,dur:3,_time:0,count:5,idx:3}], p(5))
    assert([], p(6))
    assert([], p(7))
    assert([{value:0,dur:1,_time:0,count:8,idx:4}], p(8))
  
    p = root('xo', {dur:({idx})=> idx%2 ? 1/4 : 3/4})
    assert([{value:'x',dur:3/4,_time:0,count:0,idx:0},{value:'o',dur:1/4,_time:3/4,count:3/4,idx:1}], p(0))
    assert([{value:'x',dur:3/4,_time:0,count:1,idx:0},{value:'o',dur:1/4,_time:3/4,count:7/4,idx:1}], p(1))
    assert([{value:'x',dur:3/4,_time:0,count:2,idx:0},{value:'o',dur:1/4,_time:3/4,count:11/4,idx:1}], p(2))
    assert([{value:'x',dur:3/4,_time:0,count:3,idx:0},{value:'o',dur:1/4,_time:3/4,count:15/4,idx:1}], p(3))
  
    p = root('xo', {dur:({idx})=> idx%2 ? 1/4 : 1})
    assert([{value:'x',dur:1,_time:0,count:0,idx:0}], p(0))
    assert([{value:'o',dur:1/4,_time:0,count:1,idx:1},{value:'x',dur:1,_time:1/4,count:5/4,idx:0}], p(1))
    assert([{value:'o',dur:1/4,_time:1/4,count:9/4,idx:1},{value:'x',dur:1,_time:1/2,count:10/4,idx:0}], p(2))
    assert([{value:'o',dur:1/4,_time:1/2,count:14/4,idx:1},{value:'x',dur:1,_time:3/4,count:15/4,idx:0}], p(3))
    assert([{value:'o',dur:1/4,_time:3/4,count:19/4,idx:1}], p(4))
    assert([{value:'x',dur:1,_time:0,count:20/4,idx:0}], p(5))
  
    p = root('x', {dur:({count})=>count+1})
    assert([{value:'x',dur:1,_time:0,count:0,idx:0}], p(0))
    assert([{value:'x',dur:2,_time:0,count:1,idx:1}], p(1))
    assert([], p(2))
    assert([{value:'x',dur:4,_time:0,count:3,idx:2}], p(3))
  
    p = root('x', {dur:({idx})=>[3/4,3/4,2/4][idx % 3]})
    assert([{value:'x',dur:3/4,_time:0,count:0,idx:0},{value:'x',dur:3/4,_time:3/4,count:3/4,idx:1}], p(0))
    assert([{value:'x',dur:2/4,_time:1/2,count:3/2,idx:2}], p(1))
  
    p = root('0', {dur:()=>{ return {value:1}}})
    assert([{value:0,dur:1,_time:0,count:4,idx:4}], p(4))
    assert([{value:0,dur:1,_time:0,count:5,idx:5}], p(5))
  
    p = root('0<12>', {})
    assert([{value:0,dur:1,_time:0,count:0,idx:0}], p(0))
    assert([{value:1,dur:1,_time:0,count:1,idx:1}], p(1))
    assert([{value:0,dur:1,_time:0,count:2,idx:0}], p(2))
    assert([{value:2,dur:1,_time:0,count:3,idx:1}], p(3))
    assert([{value:0,dur:1,_time:0,count:4,idx:0}], p(4))

    p = root('(0[12])', {})
    assert([
      {value:0,dur:1,_time:0,count:0,idx:0},
      {value:1,dur:1/2,_time:0,count:0,idx:0},
      {value:2,dur:1/2,_time:1/2,count:1/2,idx:1}
    ], p(0))

    p = root('([01]2)', {})
    assert([
      {value:2,dur:1,_time:0,count:0,idx:0},
      {value:0,dur:1/2,_time:0,count:0,idx:0},
      {value:1,dur:1/2,_time:1/2,count:1/2,idx:1}
    ], p(0))

    p = root('(0[12])', {})
    assert([
      {value:0,dur:1,_time:0,count:3,idx:0},
      {value:1,dur:1/2,_time:0,count:3,idx:0},
      {value:2,dur:1/2,_time:1/2,count:3+1/2,idx:1}
    ], p(3))

    p = root('<1[23]>', {})
    assert([{value:1,dur:1,_time:0,count:0,idx:0}], p(0))
    assert([{value:2,dur:1/2,_time:0,count:1,idx:1},{value:3,dur:1/2,_time:1/2,count:3/2,idx:2}], p(1))
    assert([{value:1,dur:1,_time:0,count:2,idx:3}], p(2))

    p = root('(1<23>)', {})
    assert([{value:1,dur:1,_time:0,count:0,idx:0},{value:2,dur:1,_time:0,count:0,idx:0}], p(0))
    assert([{value:1,dur:1,_time:0,count:1,idx:1},{value:3,dur:1,_time:0,count:1,idx:1}], p(1))

    p = root('(<1(23)>)', {})
    assert([{value:1,dur:1,_time:0,count:0,idx:0}], p(0))
    assert([{value:2,dur:1,_time:0,count:1,idx:1},{value:3,dur:1,_time:0,count:1,idx:1}], p(1))
    assert([{value:1,dur:1,_time:0,count:2,idx:2}], p(2))

    p = root('<[1(23)]>', {})
    assert([{value:1,dur:1/2,_time:0,count:0,idx:0},{value:2,dur:1/2,_time:1/2,count:1/2,idx:1},{value:3,dur:1/2,_time:1/2,count:1/2,idx:1}], p(0))

    p = root('<1<.3>>_', {})
    assert([{value:1,dur:2,_time:0,count:0,idx:0}], p(0))
    assert([], p(1))
    assert([], p(2))
    assert([], p(3))
    assert([{value:1,dur:2,_time:0,count:4,idx:1}], p(4))
    assert([], p(5))
    assert([{value:3,dur:2,_time:0,count:6,idx:2}], p(6))
    assert([], p(7))

    p = root('<1[2<34>]>', {})
    assert([{value:1,dur:1,_time:0,count:0,idx:0}], p(0))
    assert([{value:2,dur:1/2,_time:0,count:1,idx:1},{value:3,dur:1/2,_time:1/2,count:3/2,idx:2}], p(1))
    assert([{value:1,dur:1,_time:0,count:2,idx:3}], p(2))
    assert([{value:2,dur:1/2,_time:0,count:3,idx:4},{value:4,dur:1/2,_time:1/2,count:3+1/2,idx:5}], p(3))

    p = root('[1<2[34]>]', {})
    assert([{value:1,dur:1/2,_time:0,count:0,idx:0},{value:2,dur:1/2,_time:1/2,count:1/2,idx:1}], p(0))
    assert([{value:1,dur:1/2,_time:0,count:1,idx:0},{value:3,dur:1/4,_time:1/2,count:1+1/2,idx:1},{value:4,dur:1/4,_time:3/4,count:1+3/4,idx:2}], p(1))

    p = root('(0<1[2<3[45]>]>)', {})
    assert([{value:0,dur:1,_time:0,count:0,idx:0},{value:1,dur:1,_time:0,count:0,idx:0}], p(0))
    assert([{value:0,dur:1,_time:0,count:1,idx:1},{value:2,dur:1/2,_time:0,count:1,idx:1},{value:3,dur:1/2,_time:1/2,count:1+1/2,idx:2}], p(1))
    assert([{value:0,dur:1,_time:0,count:2,idx:3},{value:1,dur:1,_time:0,count:2,idx:3}], p(2))
    assert([{value:0,dur:1,_time:0,count:3,idx:4},{value:2,dur:1/2,_time:0,count:3,idx:4},{value:4,dur:1/4,_time:1/2,count:3+1/2,idx:5},{value:5,dur:1/4,_time:3/4,count:3+3/4,idx:6}], p(3))
    
    assertSamePattern(root('01.2', {dur:1/4}), root('[01.2]', {}))
    assertSamePattern(root('1___2___.___4___', {dur:1/4}), root('12.4', {}))
    assertSamePattern(root('[01][.2]', {dur:1/2}), root('[01.2]', {}))
    assertSamePattern(root('0123', {dur:3/4}), root('[0__1__2__3__]', {dur:3}))

    assertSameRootPatternWithDurs('[0]', '0')
    assertSameRootPatternWithDurs('[[[0]]]', '0')
    assertSameRootPatternWithDurs('<0>', '0')
    assertSameRootPatternWithDurs('<<<0>>>', '0')
    assertSameRootPatternWithDurs('[a_b_]', '[ab]')
    assertSameRootPatternWithDurs('[0_]', '[0]')
    assertSameRootPatternWithDurs('[0_]', '0')
    assertSameRootPatternWithDurs('[[[[[0]_]_]_]_]', '0')
    assertSameRootPatternWithDurs('0<1>', '01')
    assertSameRootPatternWithDurs('0[1]', '01')
    assertSameRootPatternWithDurs('[<01>_]', '<01>')
    assertSameRootPatternWithDurs('(0(23))', '(023)')
 
    assertSamePatternIgnoringIdx(root('0<12>3', {}), root('013023', {}))
    assertSamePatternIgnoringIdx(root('0<1.>', {}), root('010.', {}))
    assertSamePatternIgnoringIdx(root('0<1[23]>', {}), root('010[23]', {}))
    assertSamePatternIgnoringIdx(root('0[1<23>]', {}), root('0[12]0[13]', {}))
    assertSamePatternIgnoringIdx(root('0<1<23>>', {}), root('01020103', {}))
    assertSamePatternIgnoringIdx(root('0<1[2<34>]>', {}), root('010[23]010[24]', {}))
    assertSamePatternIgnoringIdx(root('<12>_', {}), root('12', {dur:2}))
    assertSamePatternIgnoringIdx(root('<[[[<12>__]]__]>', {}), root('12', {}))
    assertSamePatternIgnoringIdx(root('0<1(23)>', {}), root('010(23)', {}))

    assertSameAsParallel(root('(01)', {}), root('0', {}), root('1', {}))
    assertSameAsParallel(root('(0(23))', {}), root('0', {}), root('(23)', {}))
    assertSameAsParallel(root('(0[23])', {}), root('0', {}), root('[23]', {}))
    assertSameAsParallel(root('([01]2)', {}), root('2', {}), root('[01]', {}))
    assertSameAsParallel(root('(01)_', {}), root('0_', {}), root('1_', {}))
    assertSameAsParallel(root('(0[12])_', {}), root('0_', {}), root('[12]_', {}))
    assertSameAsParallel(root('(0<12>)', {}), root('0', {}), root('<12>', {}))
    assertSameAsParallel(root('(0<12>)_', {}), root('0_', {}), root('<12>_', {}))
    assertSameAsParallel(root('(0<1[2<3[45]>]>)', {}), root('0', {}), root('<1[2<3[45]>]>', {}))
    assertSameAsParallel(root('0<1(23)>', {}), root('0<12>', {}), root('.<.3>', {}))

    assertSameWhenStartLater(() => root('0', {}))
    assertSameWhenStartLater(() => root('012', {}))
    assertSameWhenStartLater(() => root('.0.', {}))
    assertSameWhenStartLater(() => root('0[12].45', {dur:()=>1/4}))
    assertSameWhenStartLater(() => root('01', {dur:()=>1}))
    assertSameWhenStartLater(() => root('01', {dur:({idx})=>{ return {value:idx%2 ? 3 : 1}}}))
    assertSameWhenStartLater(() => root('0', {dur:({idx})=>{ return {value:idx%2 ? 3 : 1}}}))
    assertSameWhenStartLater(() => root('xo', {dur:({idx})=> idx%2 ? 1/4 : 3/4}))
    assertSameWhenStartLater(() => root('xo', {dur:({idx})=> idx%2 ? 1/4 : 1}))
    assertSameWhenStartLater(() => root('0', {dur:({count})=>count+1}))
    assertSameWhenStartLater(() => root('0', {dur:()=>{ return {value:1}}}))
    assertSameWhenStartLater(() => root('0_', {}))
    assertSameWhenStartLater(() => root('0_1', {}))
    assertSameWhenStartLater(() => root('0<12>', {}))
    assertSameWhenStartLater(() => root('0<1<23>>', {}))
    assertSameWhenStartLater(() => root('0<1[2<34>]>', {}))
    assertSameWhenStartLater(() => root('<12>_', {}))
    assertSameWhenStartLater(() => root('(01)', {}))
    assertSameWhenStartLater(() => root('(01)_', {}))
    assertSameWhenStartLater(() => root('(0[12])', {}))
    assertSameWhenStartLater(() => root('(0[12])_', {}))
    assertSameWhenStartLater(() => root('([01]2)', {}))
    assertSameWhenStartLater(() => root('(0<12>)', {}))
    assertSameWhenStartLater(() => root('(0<12>)_', {}))
    assertSameWhenStartLater(() => root('0<1(23)>', {}))
    assertSameWhenStartLater(() => root('0<1(23)>', {}))
    assertSameWhenStartLater(() => root('<[1(23)]>', {}))
    // assertSameWhenStartLater(() => root('<1<.3>>_', {})) // Idx's dont match up because of the rest...
    assertSameWhenStartLater(() => root('<1[2<34>]>', {}))
    assertSameWhenStartLater(() => root('[1<2[34]>]', {}))
    assertSameWhenStartLater(() => root('(0<1[2<3[45]>]>)', {}))

    console.log("Pattern unit root tests complete")
  }
  
  return root
});
