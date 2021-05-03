'use strict';
define(function(require) {

  let evalSequence = (seq, e, r) => {
    let v = seq[r % seq.length]
    // console.log('evalSequence', e, r, v)
    return v.flatMap(({value,time,dur,sharp}) => {
      let event = {time:e.time+time*e.dur, dur:dur*e.dur, sharp:sharp}
      if (typeof(value) == 'function') {
        // console.log('evalSequence func', event, r/seq.length)
        return value(event, Math.floor(r / seq.length))
      }
      // console.log('evalSequence val', value, event)
      return [{value:value, time:event.time, dur:event.dur, sharp:event.sharp}]
    })
  }

  let step = (state) => {
    let events = []
    let dur = state.dur
    let time = state.time
    let char = state.str.charAt(state.idx)
    let sharp
    // subpattern
    if (char == '[') {
      state.idx += 1
      let subState = Object.assign({}, state)
      subState.time = 0
      subState.dur = dur
      let sub = pattern(subState, ']')
      state.idx = subState.idx
      if (sub.length === 0) { return events }
      // console.log('subpattern', state, 'sub.events', sub.events)
      sub.events.forEach(e => {
        events.push({
          value: e.value,
          time: time + e.time*dur/sub.length,
          dur: e.dur*dur/sub.length,
          step: state.step,
          sharp: e.sharp,
        })
      })
      return events
    }
    // together
    if (char == '(') {
      state.idx += 1
      let tog = array(state, ')')
      // console.log('together', tog)
      events = events.concat(tog)
      return events
    }
    // sequence
    if (char == '<') {
      state.idx += 1
      let subState = Object.assign({}, state)
      subState.time = 0
      subState.dur = 1
      let seq = array(subState, '>', true)
      state.idx = subState.idx
      if (seq.length == 0) { seq = [[]] }
      // console.log('sequence', seq)
      events.push({
        value: (e,r) => evalSequence(seq, e, r),
        time: time,
        dur: dur,
        step: state.step,
      })
      return events
    }
    // rest
    if (char == '.') {
      state.idx += 1
      // console.log('rest', state)
      events.push({
        time: time,
        dur: dur,
        step: state.step,
      })
      return events
    }
    // literal event
    let nextChar = state.str.charAt(state.idx+1)
    if (char == '-' && nextChar >= '0' && nextChar <= '9') {
      char = '-'+nextChar
      state.idx += 1
    }
    state.idx += 1
    if (!Number.isNaN(parseInt(char))) {
      let nextChar = state.str.charAt(state.idx)
      if (nextChar === '#') {
        sharp = 1
        state.idx += 1
      }
    }
    // console.log('event', state, 'value:', char, 'time:', time, 'dur:', dur)
    events.push({
      value: char,
      time: time,
      dur: dur,
      step: state.step,
      sharp: sharp,
    })
    return events
  }

  let array = (state, endChar, push) => {
    // console.log('array', endChar, state)
    let events = []
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === '') { break }
      if (char === endChar) {
        state.idx += 1
        break
      }
      let stepEvents = step(state)
      if (push) {
        events.push(stepEvents)
      } else {
        events = events.concat(stepEvents)
      }
    }
    return events
  }

  let pattern = (state, endChar) => {
    // console.log('pattern', state, endChar)
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
      state.time += state.dur
      state.step += 1
    }
    return { events: events, length: state.time }
  }

  let foldContinuations = (events) => {
    let result = []
    events.forEach(event => {
      if (event.value === '_') {
        let lastTime = result[result.length-1].time
        // console.log('continuation', event, 'lastTime', lastTime)
        result.filter(e => e.time == lastTime).forEach(e => e.dur += event.dur)
      } else {
        result.push(event)
      }
    })
    return result
  }

  let parsePattern = (patternStr, durs) => {
    // console.log('*** parsePattern', patternStr, durs)
    let state = {
      str: patternStr.trim(),
      idx: 0,
      time: 0,
      step: 0,
      dur: 1, // parse step-by-step; only apply durs after
    }
    let result = pattern(state)
    // console.log('result', result)
    result.events = result.events.map(e => {
      if (e.time < -0.0001) {e.time += result.length}
      if (e.time > result.length-0.0001) {e.time -= result.length}
      return e
    }).sort((a,b) => a.time-b.time)

    if (typeof durs == 'number') {
      durs = [durs]
    }
    let events = []
    let patternCount = result.events.length
    let dursCount = durs.length
    let stepTime = 0
    if (patternCount > 0 && dursCount > 0) {
      let patternLength = result.length
      let step = 0
      let patternIdx = 0
      let dursIdx = 0
      while (step < Math.max(dursCount, patternLength)) { // loop over events in entire pattern
        let stepDur = durs[dursIdx]
        let currentStep = result.events[patternIdx].step
        while (result.events[patternIdx].step == currentStep) { // loop over events in step
          let event = result.events[patternIdx]
          events.push({
            value:event.value,
            time:stepTime + (event.time-event.step)*stepDur,
            dur:event.dur*stepDur,
            sharp:event.sharp,
          })
          patternIdx++
          if (patternIdx >= patternCount) {
            patternIdx -= patternCount
            break
          }
        }
        stepTime += stepDur
        step++
        dursIdx = (dursIdx + 1) % dursCount
      }
    }

    events = foldContinuations(events)
    return {
      length: stepTime,
      events: events,
    }
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

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
  assertPattern(0, [], parsePattern('[]', 1))

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

  assertPattern(3, [
    {value:'x',time:0, dur:1/2},
    {value:'o',time:1/2, dur:1/2},
    {value:'x',time:1, dur:1},
    {value:'o',time:2, dur:1},
  ], parsePattern('[xo]', [1,2]))

  assertPattern(1, [
    {value:'x',time:0, dur:1},
    {value:'o',time:0, dur:1},
  ], parsePattern('(xo)', 1))

  assertPattern(3, [
    {value:'x',time:0, dur:1},
    {value:'o',time:0, dur:1},
    {value:'x',time:1, dur:2},
    {value:'o',time:1, dur:2},
  ], parsePattern('(xo)', [1,2]))

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
  assert([], p.events[0].value({time:1,dur:1},0))
  assert([], p.events[0].value({time:1,dur:1},1))

  p = parsePattern('<0>', 1)
  assert(1, p.length)
  assert([{value:'0',time:0, dur:1}], p.events[0].value({time:0,dur:1},0))
  assert([{value:'0',time:0, dur:1}], p.events[0].value({time:0,dur:1},1))

  p = parsePattern('0<1>', 1)
  assert(2, p.length)
  assert({value:'0',time:0, dur:1}, p.events[0])
  assert([{value:'1',time:1, dur:1}], p.events[1].value({time:1,dur:1},0))
  assert([{value:'1',time:1, dur:1}], p.events[1].value({time:1,dur:1},1))

  p = parsePattern('0<12>', 1)
  assert(2, p.length)
  assert({value:'0',time:0, dur:1}, p.events[0])
  assert([{value:'1',time:1, dur:1}], p.events[1].value({time:1,dur:1},0))
  assert([{value:'2',time:1, dur:1}], p.events[1].value({time:1,dur:1},3))

  p = parsePattern('0<123><45>', 1/3)
  assert(1, p.length)
  assert({value:'0',time:0, dur:1/3}, p.events[0])
  assert([{value:'1',time:1/3, dur:1/3}], p.events[1].value({time:1/3,dur:1/3},0))
  assert([{value:'4',time:2/3, dur:1/3}], p.events[2].value({time:2/3,dur:1/3},0))
  assert([{value:'2',time:1/3, dur:1/3}], p.events[1].value({time:1/3,dur:1/3},1))
  assert([{value:'5',time:2/3, dur:1/3}], p.events[2].value({time:2/3,dur:1/3},1))
  assert([{value:'3',time:1/3, dur:1/3}], p.events[1].value({time:1/3,dur:1/3},2))
  assert([{value:'4',time:2/3, dur:1/3}], p.events[2].value({time:2/3,dur:1/3},2))

  p = parsePattern('<1<23>4>', 1)
  assert(1, p.length)
  assert([{value:'1',time:0, dur:1}], p.events[0].value({time:0,dur:1},0))
  assert([{value:'2',time:0, dur:1}], p.events[0].value({time:0,dur:1},1))
  assert([{value:'4',time:0, dur:1}], p.events[0].value({time:0,dur:1},2))
  assert([{value:'1',time:0, dur:1}], p.events[0].value({time:0,dur:1},3))
  assert([{value:'3',time:0, dur:1}], p.events[0].value({time:0,dur:1},4))
  assert([{value:'4',time:0, dur:1}], p.events[0].value({time:0,dur:1},5))
  assert([{value:'1',time:0, dur:1}], p.events[0].value({time:0,dur:1},6))

  p = parsePattern('<1<2<34>>>', 1)
  assert(1, p.length)
  assert([{value:'1',time:0, dur:1}], p.events[0].value({time:0,dur:1},0))
  assert([{value:'2',time:0, dur:1}], p.events[0].value({time:0,dur:1},1))
  assert([{value:'1',time:0, dur:1}], p.events[0].value({time:0,dur:1},2))
  assert([{value:'3',time:0, dur:1}], p.events[0].value({time:0,dur:1},3))
  assert([{value:'1',time:0, dur:1}], p.events[0].value({time:0,dur:1},4))
  assert([{value:'2',time:0, dur:1}], p.events[0].value({time:0,dur:1},5))
  assert([{value:'1',time:0, dur:1}], p.events[0].value({time:0,dur:1},6))
  assert([{value:'4',time:0, dur:1}], p.events[0].value({time:0,dur:1},7))
  assert([{value:'1',time:0, dur:1}], p.events[0].value({time:0,dur:1},8))

  p = parsePattern('<0.>', 1)
  assert(1, p.length)
  assert([{value:'0',time:0, dur:1}], p.events[0].value({time:0,dur:1},0))
  assert([{time:0,dur:1}], p.events[0].value({time:0,dur:1},1))
  assert([{value:'0',time:0, dur:1}], p.events[0].value({time:0,dur:1},2))

  p = parsePattern('<1[23]>', 1)
  assert(1, p.length)
  assert([{value:'1',time:0, dur:1}], p.events[0].value({time:0,dur:1},0))
  assert([{value:'2',time:0, dur:1/2},{value:'3',time:1/2, dur:1/2}], p.events[0].value({time:0,dur:1},1))
  assert([{value:'1',time:0, dur:1}], p.events[0].value({time:0,dur:1},2))

  p = parsePattern('[1<23>]', 1)
  assert(1, p.length)
  assert({value:'1',time:0, dur:1/2}, p.events[0])
  assert([{value:'2',time:1/2, dur:1/2}], p.events[1].value({time:0.5,dur:0.5},0))
  assert([{value:'3',time:1/2, dur:1/2}], p.events[1].value({time:0.5,dur:0.5},1))

  p = parsePattern('(1<23>)', 1)
  assert(1, p.length)
  assert({value:'1',time:0, dur:1}, p.events[0])
  assert([{value:'2',time:0, dur:1}], p.events[1].value({time:0,dur:1},0))
  assert([{value:'3',time:0, dur:1}], p.events[1].value({time:0,dur:1},1))

  p = parsePattern('<1(23)>', 1)
  assert(1, p.length)
  assert([{value:'1',time:0, dur:1}], p.events[0].value({time:0,dur:1},0))
  assert([{value:'2',time:0, dur:1},{value:'3',time:0, dur:1}], p.events[0].value({time:0,dur:1},1))

  p = parsePattern('<[1(23)]>', 1)
  assert(1, p.length)
  assert([{value:'1',time:0, dur:1/2},{value:'2',time:1/2, dur:1/2},{value:'3',time:1/2, dur:1/2}], p.events[0].value({time:0,dur:1},0))

  p = parsePattern('<1<.3>>_', 1)
  assert(2, p.length)
  assert([{value:'1',time:0, dur:2}], p.events[0].value({time:0,dur:2},0))
  assert([{time:0, dur:2}], p.events[0].value({time:0,dur:2},1))
  assert([{value:'1',time:0, dur:2}], p.events[0].value({time:0,dur:2},2))
  assert([{value:'3',time:0, dur:2}], p.events[0].value({time:0,dur:2},3))

  p = parsePattern('<1[2<34>]>', 1)
  assert(1, p.length)
  assert([{value:'1',time:0, dur:1}], p.events[0].value({time:0,dur:1},0))
  assert([{value:'2',time:0, dur:1/2},{value:'3',time:1/2, dur:1/2}], p.events[0].value({time:0,dur:1},1))
  assert([{value:'1',time:0, dur:1}], p.events[0].value({time:0,dur:1},2))
  assert([{value:'2',time:0, dur:1/2},{value:'4',time:1/2, dur:1/2}], p.events[0].value({time:0,dur:1},3))

  p = parsePattern('[1<2[34]>]', 1)
  assert(1, p.length)
  assert({value:'1',time:0, dur:1/2}, p.events[0])
  assert([{value:'2',time:1/2, dur:1/2}], p.events[1].value({time:1/2,dur:1/2},0))
  assert([{value:'3',time:1/2, dur:1/4},{value:'4',time:3/4, dur:1/4}], p.events[1].value({time:1/2,dur:1/2},1))

  p = parsePattern('(0<1[2<3[45]>]>)', 1)
  assert(1, p.length)
  assert({value:'0',time:0, dur:1}, p.events[0])
  assert([{value:'1',time:0, dur:1}], p.events[1].value({time:0,dur:1},0))
  assert([{value:'2',time:0, dur:1/2},{value:'3',time:1/2, dur:1/2}], p.events[1].value({time:0,dur:1},1))
  assert([{value:'1',time:0, dur:1}], p.events[1].value({time:0,dur:1},2))
  assert([{value:'2',time:0, dur:1/2},{value:'4',time:1/2, dur:1/4},{value:'5',time:3/4, dur:1/4}], p.events[1].value({time:0,dur:1},3))

  p = parsePattern('0#', 1)
  assert(1, p.length)
  assert({value:'0',time:0,dur:1,sharp:1}, p.events[0])

  p = parsePattern('0#1', 1)
  assert(2, p.length)
  assert({value:'0',time:0,dur:1,sharp:1}, p.events[0])
  assert({value:'1',time:1,dur:1}, p.events[1])

  p = parsePattern('1#2#', 1)
  assert(2, p.length)
  assert({value:'1',time:0,dur:1,sharp:1}, p.events[0])
  assert({value:'2',time:1,dur:1, sharp:1}, p.events[1])

  assert({value:'-1',time:0,dur:1,sharp:1}, parsePattern('-1#', 1).events[0])
  assert({value:'0',time:0,dur:2,sharp:1}, parsePattern('0#_', 1).events[0])
  assert({value:'#',time:0,dur:1}, parsePattern('#', 1).events[0])

  p = parsePattern('a#', 1)
  assert(2, p.length)
  assert({value:'a',time:0,dur:1}, p.events[0])
  assert({value:'#',time:1,dur:1}, p.events[1])

  assert([{value:'0',time:0,dur:1,sharp:1}], parsePattern('<0#>', 1).events[0].value({time:0,dur:1},0))

  assertPattern(1, [{value:'0',time:0,dur:1,sharp:1}], parsePattern('[0#]', 1))
  assertPattern(1, [{value:'0',time:0,dur:1,sharp:1}], parsePattern('(0#)', 1))

  // '0b'
  // 'ab'


  // p = parsePattern('<1[.3]>_', 1)
  // assert(2, p.length)
  // assert([{value:'1',time:0, dur:2}], p.events[0].value({time:0,dur:1},0))
  // assert([{value:'3',time:1/2, dur:3/2}], p.events[0].value({time:0,dur:1},1))

  // <.(12)>_
  // 0<1_>

  console.log("Parse pattern tests complete")
  }
  
  return parsePattern
});
