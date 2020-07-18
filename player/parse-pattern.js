'use strict';
define(function(require) {
  let debug = false

  let pattern = (state, time, step, durs, endChar) => {
    if (debug) { console.log('pattern', state, durs) }
    let events = []
    let length = 0
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === '') { break }
      if (char === endChar) {
        state.idx += 1
        break
      }
      let dur = durs[step % durs.length]
      // subdivision
      if (char == '[') {
        state.idx += 1
        let sub = pattern(state, 0, step, [dur], ']')
        if (sub.length === 0) { continue }
        if (debug) { console.log('subdivision', state, 'sub', sub) }
        sub.events.forEach(e => {
          events.push({
            value: e.value,
            time: time + e.time*dur/sub.length,
            dur: e.dur*dur/sub.length,
          })
        })
        time += dur
        step += 1
        continue
      }
      // rest
      if (char == '.') {
        state.idx += 1
        if (debug) { console.log('rest', state) }
        time += dur
        step += 1
        continue
      }
      // actual event
      let nextChar = state.str.charAt(state.idx+1)
      if (char == '-' && nextChar >= '0' && nextChar <= '9') {
        char = '-'+nextChar
        state.idx += 1
      }
      state.idx += 1
      if (debug) { console.log('event', state, 'value:', char, 'time:', time, 'dur:', dur) }
      events.push({
        value: char,
        time: time,
        dur: dur,
      })
      time += dur
      step += 1
    }
    return { events: events, length: time }
  }

  let foldContinuations = (events) => {
    let result = []
    events.forEach(event => {
      if (event.value === '_') {
        let lastTime = result[result.length-1].time
        if (debug) { console.log('continuation', event, 'lastTime', lastTime) }
        result.filter(e => e.time == lastTime).forEach(e => e.dur += event.dur)
      } else {
        result.push(event)
      }
    })
    return result
  }

  let parsePattern = (patternStr, dur) => {
    if (debug) { console.log('*** parsePattern', patternStr, dur) }
    if (!Array.isArray(dur)) { dur = [dur] }
    let state = {
      str: patternStr.trim(),
      idx: 0,
    }
    let result = pattern(state, 0, 0, dur)
    let events = result.events
      .map(e => {
        if (e.time < -0.0001) {e.time += result.length}
        if (e.time > result.length-0.0001) {e.time -= result.length}
        return e
      })
      .sort((a,b) => a.time-b.time)
    if (result.length > 0) {
      let extraStepIdx = 0
      let durLength = dur.reduce((l,r)=>l+r, 0)
      while (durLength > result.length) {
        let newEvent = Object.assign({}, events[extraStepIdx])
        newEvent.time = result.length
        newEvent.dur = dur[events.length % dur.length]
        events.push(newEvent)
        result.length += newEvent.dur
        extraStepIdx + 1
      }
    }
    events = foldContinuations(events)
    return {
      length: result.length,
      events: events,
    }
  }

  // TESTS //

  let assert = (expectedLength, expectedValues, actual) => {
    if (expectedLength !== actual.length) { console.trace(`Assertion failed.\n>>Expected length:\n  ${expectedLength}\n>>Actual:\n  ${actual.length}`) }
    let x = JSON.stringify(expectedValues, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual.events, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  assert(0, [], parsePattern('', 1))
  assert(0, [], parsePattern('[]', 1))

  assert(1, [
    {value:'x',time:0, dur:1},
  ], parsePattern('x', 1))

  assert(2, [
    {value:'x',time:0, dur:1},
    {value:'o',time:1, dur:1},
  ], parsePattern('xo', 1))

  assert(5, [
    {value:'x',time:0, dur:2},
    {value:'o',time:2, dur:3},
  ], parsePattern('xo', [2,3]))

  assert(7, [
    {value:'0',time:0, dur:2},
    {value:'-1',time:2, dur:3},
    {value:'1',time:5, dur:2},
  ], parsePattern('0-11', [2,3]))

  assert(3, [
    {value:'x',time:0, dur:1},
    {value:'-',time:1, dur:1},
    {value:'o',time:2, dur:1},
  ], parsePattern('x-o', 1))

  assert(1/2, [
    {value:'x',time:0, dur:1/2},
  ], parsePattern('x', 1/2))

  assert(2, [
    {value:'x',time:0, dur:2},
  ], parsePattern('x', 2))

  assert(2, [
    {value:'x',time:1, dur:1},
  ], parsePattern('.x', 1))

  assert(2, [
    {value:'x',time:0, dur:1},
  ], parsePattern('x.', 1))

  assert(1, [
    {value:'x',time:0, dur:1/2},
    {value:'o',time:1/2, dur:1/2},
  ], parsePattern('[xo]', 1))

  assert(1, [
    {value:'x',time:0, dur:1/4},
    {value:'o',time:1/4, dur:1/4},
  ], parsePattern('[xo].', 1/2))

  assert(1, [
    {value:'0',time:0, dur:1/2},
    {value:'1',time:1/2, dur:1/4},
    {value:'2',time:3/4, dur:1/4},
  ], parsePattern('[0[12]]', 1))

  assert(2, [
    {value:'0',time:0, dur:2},
  ], parsePattern('0_', 1))

  assert(3, [
    {value:'0',time:0, dur:3/2},
    {value:'1',time:3/2, dur:3/2},
  ], parsePattern('0[_1]_', 1))

  assert(2, [
    {value:'0',time:0, dur:2},
  ], parsePattern('[0_]_', 1))

  assert(2, [
    {value:'x',time:0, dur:1},
    {value:'x',time:1, dur:1/2},
    {value:'x',time:3/2, dur:1/2},
  ], parsePattern('x', [1,1/2,1/2]))

  assert(2, [
    {value:'x',time:0, dur:1},
    {value:'o',time:1, dur:1/2},
    {value:'x',time:3/2, dur:1/2},
  ], parsePattern('xo', [1,1/2,1/2]))

  assert(1, [
    {value:'x',time:0, dur:1},
    {value:'x',time:0, dur:1},
  ], parsePattern('(xx)', 1))

  assert(2, [
    {value:'0',time:0, dur:2},
    {value:'1',time:0, dur:2},
  ], parsePattern('(01)_', 1))

  assert(2, [
    {value:'x',time:0, dur:1},
    {value:'o',time:1, dur:1},
    {value:'-',time:1, dur:1/2},
    {value:'-',time:3/2, dur:1/2},
  ], parsePattern('x(o[--])', 1))

  assert(2, [
    {value:'x',time:0, dur:1},
    {value:'o',time:1, dur:1},
    {value:'-',time:1, dur:1/2},
    {value:'-',time:3/2, dur:1/2},
  ], parsePattern('x([--]o)', 1))

  console.log("Parse pattern tests complete")

  return parsePattern
});
