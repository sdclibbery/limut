'use strict';
define(function(require) {
  let debug = false

  let step = (state) => {
    let events = []
    let dur = state.durs[state.step % state.durs.length]
    let char = state.str.charAt(state.idx)
    // subdivision
    if (char == '[') {
      state.idx += 1
      let subState = Object.assign({}, state)
      subState.time = 0
      let sub = pattern(subState, ']')
      state.idx = subState.idx
      if (sub.length === 0) { return events }
      sub.events.forEach(e => {
        if (debug) { console.log('subdivision', state, 'e', e, 'sub.length', sub.length) }
        events.push({
          value: e.value,
          time: state.time + e.time*dur/sub.length,
          dur: e.dur*dur/sub.length,
        })
      })
      state.step += 1
      state.time += dur
      return events
    }
    // rest
    if (char == '.') {
      state.idx += 1
      if (debug) { console.log('rest', state) }
      state.time += dur
      state.step += 1
      return events
    }
    // actual event
    let nextChar = state.str.charAt(state.idx+1)
    if (char == '-' && nextChar >= '0' && nextChar <= '9') {
      char = '-'+nextChar
      state.idx += 1
    }
    state.idx += 1
    if (debug) { console.log('event', state, 'value:', char, 'time:', state.time, 'dur:', dur) }
    events.push({
      value: char,
      time: state.time,
      dur: dur,
    })
    state.time += dur
    state.step += 1
    return events
  }

  let pattern = (state, endChar) => {
    if (debug) { console.log('pattern', state, endChar) }
    let events = []
    let length = 0
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === '') { break }
      if (char === endChar) {
        state.idx += 1
        break
      }
      let stepEvents = step(state)
      events = events.concat(stepEvents)
    }
    return { events: events, length: state.time }
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

  let parsePattern = (patternStr, durs) => {
    if (debug) { console.log('*** parsePattern', patternStr, durs) }
    if (!Array.isArray(durs)) { durs = [durs] }
    let state = {
      str: patternStr.trim(),
      idx: 0,
      time: 0,
      step: 0,
      durs: durs,
    }
    let result = pattern(state)
    if (debug) { console.log('result', result) }
    let events = result.events
      .map(e => {
        if (e.time < -0.0001) {e.time += result.length}
        if (e.time > result.length-0.0001) {e.time -= result.length}
        return e
      })
      .sort((a,b) => a.time-b.time)
    if (result.length > 0) {
      let extraStepIdx = 0
      let durLength = durs.reduce((l,r)=>l+r, 0)
      while (durLength > result.length) {
        let newEvent = Object.assign({}, events[extraStepIdx])
        newEvent.time = result.length
        newEvent.dur = durs[events.length % durs.length]
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
