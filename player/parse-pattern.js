'use strict';
define(function(require) {
  let debug = false

  let evalSequence = (seq, r) => {
    let v = seq[r % seq.length]
    return v.flatMap(({value,time,dur}) => {
      let v = value
      if (typeof(v) == 'function') {
        return v(Math.floor(r / seq.length))
      }
      return [{value:v, time:time, dur:dur}]
    })
  }

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
      return events
    }
    // together
    if (char == '(') {
      state.idx += 1
      let tog = array(state, dur, ')')
      if (debug) { console.log('together', tog) }
      events = events.concat(tog)
      return events
    }
    // sequence
    if (char == '<') {
      state.idx += 1
      let seq = array(state, dur, '>').map(v => (Array.isArray(v) ? v : [v]))
      if (seq.length == 0) { seq = [[]] }
      if (debug) { console.log('sequence', seq) }
      events.push({
        value: r => evalSequence(seq, r),
        time: state.time,
        dur: dur,
      })
      return events
    }
    // rest
    if (char == '.') {
      state.idx += 1
      if (debug) { console.log('rest', state) }
      events.push({
        time: state.time,
        dur: dur,
      })
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
    return events
  }

  let array = (state, dur, endChar) => {
    if (debug) { console.log('array', endChar, state, 'dur', dur) }
    let events = []
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
      let dur = state.durs[state.step % state.durs.length]
      state.time += dur
      state.step += 1
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
    let events = result.events.map(e => {
      if (e.time < -0.0001) {e.time += result.length}
      if (e.time > result.length-0.0001) {e.time -= result.length}
      return e
    }).sort((a,b) => a.time-b.time)
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

  let assertPattern = (expectedLength, expectedValues, actual) => {
    if (expectedLength !== actual.length) { console.trace(`Assertion failed.\n>>Expected length:\n  ${expectedLength}\n>>Actual:\n  ${actual.length}`) }
    let x = JSON.stringify(expectedValues, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual.events, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  assertPattern(0, [], parsePattern('', 1))
  assertPattern(1, [], parsePattern('[]', 1))

  assertPattern(1, [
    {value:'x',time:0, dur:1},
  ], parsePattern('x', 1))

  assertPattern(2, [
    {value:'x',time:0, dur:1},
    {value:'o',time:1, dur:1},
  ], parsePattern('xo', 1))

  assertPattern(5, [
    {value:'x',time:0, dur:2},
    {value:'o',time:2, dur:3},
  ], parsePattern('xo', [2,3]))

  assertPattern(7, [
    {value:'0',time:0, dur:2},
    {value:'-1',time:2, dur:3},
    {value:'1',time:5, dur:2},
  ], parsePattern('0-11', [2,3]))

  assertPattern(3, [
    {value:'x',time:0, dur:1},
    {value:'-',time:1, dur:1},
    {value:'o',time:2, dur:1},
  ], parsePattern('x-o', 1))

  assertPattern(1/2, [
    {value:'x',time:0, dur:1/2},
  ], parsePattern('x', 1/2))

  assertPattern(2, [
    {value:'x',time:0, dur:2},
  ], parsePattern('x', 2))

  assertPattern(2, [
    {time:0,dur:1},
    {value:'x',time:1, dur:1},
  ], parsePattern('.x', 1))

  assertPattern(2, [
    {value:'x',time:0, dur:1},
    {time:1,dur:1},
  ], parsePattern('x.', 1))

  assertPattern(1, [
    {value:'x',time:0, dur:1/2},
    {value:'o',time:1/2, dur:1/2},
  ], parsePattern('[xo]', 1))

  assertPattern(1, [
    {value:'x',time:0, dur:1/4},
    {value:'o',time:1/4, dur:1/4},
    {time:1/2,dur:1/2},
  ], parsePattern('[xo].', 1/2))

  assertPattern(1, [
    {value:'0',time:0, dur:1/2},
    {value:'1',time:1/2, dur:1/4},
    {value:'2',time:3/4, dur:1/4},
  ], parsePattern('[0[12]]', 1))

  assertPattern(2, [
    {value:'0',time:0, dur:2},
  ], parsePattern('0_', 1))

  assertPattern(3, [
    {value:'0',time:0, dur:3/2},
    {value:'1',time:3/2, dur:3/2},
  ], parsePattern('0[_1]_', 1))

  assertPattern(2, [
    {value:'0',time:0, dur:2},
  ], parsePattern('[0_]_', 1))

  assertPattern(2, [
    {value:'x',time:0, dur:1},
    {value:'x',time:1, dur:1/2},
    {value:'x',time:3/2, dur:1/2},
  ], parsePattern('x', [1,1/2,1/2]))

  assertPattern(2, [
    {value:'x',time:0, dur:1},
    {value:'o',time:1, dur:1/2},
    {value:'x',time:3/2, dur:1/2},
  ], parsePattern('xo', [1,1/2,1/2]))

  assertPattern(1, [
    {value:'x',time:0, dur:1},
    {value:'o',time:0, dur:1},
  ], parsePattern('(xo)', 1))

  assertPattern(2, [
    {value:'0',time:0, dur:2},
    {value:'1',time:0, dur:2},
  ], parsePattern('(01)_', 1))

  assertPattern(2, [
    {value:'x',time:0, dur:1},
    {value:'o',time:1, dur:1},
    {value:'-',time:1, dur:1/2},
    {value:'-',time:3/2, dur:1/2},
  ], parsePattern('x(o[--])', 1))

  assertPattern(2, [
    {value:'x',time:0, dur:1},
    {value:'-',time:1, dur:1/2},
    {value:'o',time:1, dur:1},
    {value:'-',time:3/2, dur:1/2},
  ], parsePattern('x([--]o)', 1))

  let p

  p = parsePattern('<>', 1)
  assert(1, p.length)
  assert([], p.events[0].value(0))
  assert([], p.events[0].value(1))

  p = parsePattern('<0>', 1)
  assert(1, p.length)
  assert([{value:'0',time:0, dur:1}], p.events[0].value(0))
  assert([{value:'0',time:0, dur:1}], p.events[0].value(1))

  p = parsePattern('0<1>', 1)
  assert(2, p.length)
  assert({value:'0',time:0, dur:1}, p.events[0])
  assert([{value:'1',time:1, dur:1}], p.events[1].value(0))
  assert([{value:'1',time:1, dur:1}], p.events[1].value(1))

  p = parsePattern('0<12>', 1)
  assert(2, p.length)
  assert({value:'0',time:0, dur:1}, p.events[0])
  assert([{value:'1',time:1, dur:1}], p.events[1].value(0))
  assert([{value:'2',time:1, dur:1}], p.events[1].value(3))

  p = parsePattern('0<123><45>', 1/3)
  assert(1, p.length)
  assert({value:'0',time:0, dur:1/3}, p.events[0])
  assert([{value:'1',time:1/3, dur:1/3}], p.events[1].value(0))
  assert([{value:'4',time:2/3, dur:1/3}], p.events[2].value(0))
  assert([{value:'2',time:1/3, dur:1/3}], p.events[1].value(1))
  assert([{value:'5',time:2/3, dur:1/3}], p.events[2].value(1))
  assert([{value:'3',time:1/3, dur:1/3}], p.events[1].value(2))
  assert([{value:'4',time:2/3, dur:1/3}], p.events[2].value(2))

  p = parsePattern('<1<23>4>', 1)
  assert(1, p.length)
  assert([{value:'1',time:0, dur:1}], p.events[0].value(0))
  assert([{value:'2',time:0, dur:1}], p.events[0].value(1))
  assert([{value:'4',time:0, dur:1}], p.events[0].value(2))
  assert([{value:'1',time:0, dur:1}], p.events[0].value(3))
  assert([{value:'3',time:0, dur:1}], p.events[0].value(4))
  assert([{value:'4',time:0, dur:1}], p.events[0].value(5))
  assert([{value:'1',time:0, dur:1}], p.events[0].value(6))

  p = parsePattern('<1<2<34>>>', 1)
  assert(1, p.length)
  assert([{value:'1',time:0, dur:1}], p.events[0].value(0))
  assert([{value:'2',time:0, dur:1}], p.events[0].value(1))
  assert([{value:'1',time:0, dur:1}], p.events[0].value(2))
  assert([{value:'3',time:0, dur:1}], p.events[0].value(3))
  assert([{value:'1',time:0, dur:1}], p.events[0].value(4))
  assert([{value:'2',time:0, dur:1}], p.events[0].value(5))
  assert([{value:'1',time:0, dur:1}], p.events[0].value(6))
  assert([{value:'4',time:0, dur:1}], p.events[0].value(7))
  assert([{value:'1',time:0, dur:1}], p.events[0].value(8))

  p = parsePattern('<0.>', 1)
  assert(1, p.length)
  assert([{value:'0',time:0, dur:1}], p.events[0].value(0))
  assert([{time:0,dur:1}], p.events[0].value(1))
  assert([{value:'0',time:0, dur:1}], p.events[0].value(2))

  // <1[23]>
  // [1<23>]
  // (1<23>)
  // <1(23)>
  // <[1(23)]>
  // <1<.3>>_
  // <1[.3]>_
  // <.(12)>_
  // (0<1[2<3[45]>]>)
  console.log("Parse pattern tests complete")

  return parsePattern
});
