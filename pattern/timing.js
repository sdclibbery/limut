'use strict';
define(function(require) {
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
        let hasNonRests = step.filter(e => e.value !== undefined).length > 0
        if (hasNonRests) {
          tc.numNonRests++
          idx++
        }
        let e = (step.toSorted((a,b) => a.dur - b.dur))[0] // Get shortest event
        count += duration * e.dur
      }
      numSteps++
      if (numSteps > 128) { // If the pattern is crazy long, act as if its a single stepper
        break
      }
    } while (step !== undefined)
    tc.patternLength = count
  }

  let toPreviousStart = (pattern, count, dur, tc) => {
    tc.patternCount = 0
    tc.idx = 0
    calculatePatternInfo(pattern, dur, tc)
    if (typeof dur !== 'number') { // Complex dur: init by counting up from zero. Slow but accurate for this case
      let duration = mainParam(evalParamFrame(dur, {idx: 0, count: 0}, 0), 1)
      if (duration < 1/8) {
        tc.patternCount = count-1 // If durations are very short, don't do full brute force init from count 0
      }
      pattern.reset(0)
      return // Return and allow the stepToCount in initTimingContext to step through from zero
    }
    let numTimesLooped = Math.trunc(count / tc.patternLength)
    pattern.reset(numTimesLooped)
    tc.patternCount = tc.patternLength * numTimesLooped
    if (tc.numNonRests === 1) { // Only one actual event in the pattern; init idx for a single step pattern
      tc.idx = numTimesLooped
    }
  }

  let initTimingContext = (tc, count, pattern, dur, playFromStart) => {
    pattern.reset(0)
    tc.idx = 0
    if (count === 0 || playFromStart) {
      calculatePatternInfo(pattern, dur, tc)
      pattern.reset(0)
      tc.patternCount = count
      return
    }
    toPreviousStart(pattern, count, dur, tc) // Jump to the pattern restart point just before count-1
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
      if (chord === undefined) {
        chord = [{dur:1}] // Default to a one beat rest if there is still nothing after looping
      }
      let anyNotRest = false
      chord
      .toSorted((a,b) => (b.playDur || b.dur) - (a.playDur || a.dur))
      .forEach(sourceEvent => {
        let isRest = sourceEvent.value === undefined
        if (!isRest) { anyNotRest = true }
        let event = Object.assign({}, sourceEvent)
        if (typeof event.value === 'function') {
          event.value = event.value(tc)
        }
        let startTime = tc.patternCount - count
        if (event.tieDur !== undefined && tc.tie === undefined) {
          tc.tie = {
            totalDur: sourceEvent.tieDur,
            remainingDur: sourceEvent.tieDur,
            startTime : startTime,
            startCount: count + startTime,
          }
        }
        if (tc.tie !== undefined) {
          tc.tie.remainingDur -= sourceEvent.dur
          delete event.tieDur
          event.dur = tc.tie.totalDur * duration
          event._time = tc.tie.startTime
          event.count = tc.tie.startCount
          event.playDur = sourceEvent.dur * duration
          event.playTime = startTime
          event.playCount = count + startTime
          if (tc.tie.remainingDur <= 0) { delete tc.tie }
        } else {
          event.dur = sourceEvent.dur * duration
          event._time = startTime
          event.count = count + startTime
        }
        event.idx = tc.idx
        eventsForBeat.push(event)
      })
      let lastEvent = eventsForBeat[eventsForBeat.length-1]
      tc.patternCount += lastEvent.playDur || lastEvent.dur // Events are sorted so shortest duration is last
      if (anyNotRest) { tc.idx++ }
    }
    return eventsForBeat
  }
  
  return {
    initTimingContext: initTimingContext,
    stepToCount: stepToCount,
  }
});
