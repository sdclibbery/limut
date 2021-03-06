'use strict';
define(function(require) {

  let evalSequence = (seq, e, r) => {
    let v = seq[r % seq.length]
    // console.log('evalSequence', e, r, v)
    return v.flatMap(({value,_time,dur,sharp,loud,long}) => {
      let event = {_time:e._time+_time*e.dur, dur:dur*e.dur, sharp:sharp, loud:loud, long:long}
      if (typeof(value) == 'function') {
        // console.log('evalSequence func', event, r/seq.length)
        return value(event, Math.floor(r / seq.length))
      }
      // console.log('evalSequence val', value, event)
      return [{value:value, _time:event._time, dur:event.dur, sharp:event.sharp, loud:event.loud, long:event.long}]
    })
  }

  let step = (state) => {
    let events = []
    let dur = state.dur
    let _time = state._time
    let char = state.str.charAt(state.idx)
    let sharp
    let loud
    let long
    // subpattern
    if (char == '[') {
      state.idx += 1
      let subState = Object.assign({}, state)
      subState._time = 0
      subState.dur = dur
      let sub = pattern(subState, ']')
      state.idx = subState.idx
      if (sub.length === 0) { return events }
      // console.log('subpattern', state, 'sub.events', sub.events)
      sub.events.forEach(e => {
        events.push({
          value: e.value,
          _time: _time + e._time*dur/sub.length,
          dur: e.dur*dur/sub.length,
          step: state.step,
          sharp: e.sharp,
          loud: e.loud,
          long: e.long,
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
      subState._time = 0
      subState.dur = 1
      let seq = array(subState, '>', true)
      state.idx = subState.idx
      if (seq.length == 0) { seq = [[]] }
      // console.log('sequence', seq)
      events.push({
        value: (e,r) => evalSequence(seq, e, r),
        _time: _time,
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
        _time: _time,
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
    // Modifiers
    if (!Number.isNaN(parseInt(char))) {
      let done
      while (!done) {
        let nextChar = state.str.charAt(state.idx)
        switch (nextChar) {
          case '#': sharp = 1;   break;
          case 'b': sharp = -1;  break;
          case '^': loud = 1.5;  break;
          case 'v': loud = 0.5;  break;
          case '=': long = 2;    break;
          case '!': long = 0.5;  break;
          default : done = true; break;
        }
        if (!done) { state.idx += 1 }
      }
    } else {
      if (state.str.charAt(state.idx) == '^') { // Loud modifier works for non numeric pattern chars too
        loud = 1.5
        state.idx += 1
      }
    }
    // console.log('event', state, 'value:', char, '_time:', _time, 'dur:', dur)
    events.push({
      value: char,
      _time: _time,
      dur: dur,
      step: state.step,
      sharp: sharp,
      loud: loud,
      long: long,
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
      state._time += state.dur
      state.step += 1
    }
    return { events: events, length: state._time }
  }

  let foldContinuations = (events) => {
    let result = []
    events.forEach(event => {
      if (event.value === '_') {
        let lastTime = result[result.length-1]._time
        // console.log('continuation', event, 'lastTime', lastTime)
        result.filter(e => e._time == lastTime).forEach(e => e.dur += event.dur)
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
      _time: 0,
      step: 0,
      dur: 1, // parse step-by-step; only apply durs after
    }
    let result = pattern(state)
    // console.log('result', result)
    result.events = result.events.map(e => {
      if (e._time < -0.0001) {e._time += result.length}
      if (e._time > result.length-0.0001) {e._time -= result.length}
      return e
    }).sort((a,b) => a._time-b._time)

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
            _time:stepTime + (event._time-event.step)*stepDur,
            dur:event.dur*stepDur,
            sharp:event.sharp,
            loud:event.loud,
            long: event.long,
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
    {value:'x',_time:0, dur:1},
  ], parsePattern('x', 1))

  assertPattern(2, [
    {value:'x',_time:0, dur:1},
    {value:'o',_time:1, dur:1},
  ], parsePattern('xo', 1))

  assertPattern(5, [
    {value:'x',_time:0, dur:2},
    {value:'o',_time:2, dur:3},
  ], parsePattern('xo', [2,3]))

  assertPattern(7, [
    {value:'0',_time:0, dur:2},
    {value:'-1',_time:2, dur:3},
    {value:'1',_time:5, dur:2},
  ], parsePattern('0-11', [2,3]))

  assertPattern(3, [
    {value:'x',_time:0, dur:1},
    {value:'-',_time:1, dur:1},
    {value:'o',_time:2, dur:1},
  ], parsePattern('x-o', 1))

  assertPattern(1/2, [
    {value:'x',_time:0, dur:1/2},
  ], parsePattern('x', 1/2))

  assertPattern(2, [
    {value:'x',_time:0, dur:2},
  ], parsePattern('x', 2))

  assertPattern(2, [
    {_time:0,dur:1},
    {value:'x',_time:1, dur:1},
  ], parsePattern('.x', 1))

  assertPattern(2, [
    {value:'x',_time:0, dur:1},
    {_time:1,dur:1},
  ], parsePattern('x.', 1))

  assertPattern(1, [
    {value:'x',_time:0, dur:1/2},
    {value:'o',_time:1/2, dur:1/2},
  ], parsePattern('[xo]', 1))

  assertPattern(1, [
    {value:'x',_time:0, dur:1/4},
    {value:'o',_time:1/4, dur:1/4},
    {_time:1/2,dur:1/2},
  ], parsePattern('[xo].', 1/2))

  assertPattern(1, [
    {value:'0',_time:0, dur:1/2},
    {value:'1',_time:1/2, dur:1/4},
    {value:'2',_time:3/4, dur:1/4},
  ], parsePattern('[0[12]]', 1))

  assertPattern(2, [
    {value:'0',_time:0, dur:2},
  ], parsePattern('0_', 1))

  assertPattern(3, [
    {value:'0',_time:0, dur:3/2},
    {value:'1',_time:3/2, dur:3/2},
  ], parsePattern('0[_1]_', 1))

  assertPattern(2, [
    {value:'0',_time:0, dur:2},
  ], parsePattern('[0_]_', 1))

  assertPattern(2, [
    {value:'x',_time:0, dur:1},
    {value:'x',_time:1, dur:1/2},
    {value:'x',_time:3/2, dur:1/2},
  ], parsePattern('x', [1,1/2,1/2]))

  assertPattern(2, [
    {value:'x',_time:0, dur:1},
    {value:'o',_time:1, dur:1/2},
    {value:'x',_time:3/2, dur:1/2},
  ], parsePattern('xo', [1,1/2,1/2]))

  assertPattern(3, [
    {value:'x',_time:0, dur:1/2},
    {value:'o',_time:1/2, dur:1/2},
    {value:'x',_time:1, dur:1},
    {value:'o',_time:2, dur:1},
  ], parsePattern('[xo]', [1,2]))

  assertPattern(1, [
    {value:'x',_time:0, dur:1},
    {value:'o',_time:0, dur:1},
  ], parsePattern('(xo)', 1))

  assertPattern(3, [
    {value:'x',_time:0, dur:1},
    {value:'o',_time:0, dur:1},
    {value:'x',_time:1, dur:2},
    {value:'o',_time:1, dur:2},
  ], parsePattern('(xo)', [1,2]))

  assertPattern(2, [
    {value:'0',_time:0, dur:2},
    {value:'1',_time:0, dur:2},
  ], parsePattern('(01)_', 1))

  assertPattern(2, [
    {value:'x',_time:0, dur:1},
    {value:'o',_time:1, dur:1},
    {value:'-',_time:1, dur:1/2},
    {value:'-',_time:3/2, dur:1/2},
  ], parsePattern('x(o[--])', 1))

  assertPattern(2, [
    {value:'x',_time:0, dur:1},
    {value:'-',_time:1, dur:1/2},
    {value:'o',_time:1, dur:1},
    {value:'-',_time:3/2, dur:1/2},
  ], parsePattern('x([--]o)', 1))

  let p

  p = parsePattern('<>', 1)
  assert(1, p.length)
  assert([], p.events[0].value({_time:1,dur:1},0))
  assert([], p.events[0].value({_time:1,dur:1},1))

  p = parsePattern('<0>', 1)
  assert(1, p.length)
  assert([{value:'0',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},0))
  assert([{value:'0',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},1))

  p = parsePattern('0<1>', 1)
  assert(2, p.length)
  assert({value:'0',_time:0, dur:1}, p.events[0])
  assert([{value:'1',_time:1, dur:1}], p.events[1].value({_time:1,dur:1},0))
  assert([{value:'1',_time:1, dur:1}], p.events[1].value({_time:1,dur:1},1))

  p = parsePattern('0<12>', 1)
  assert(2, p.length)
  assert({value:'0',_time:0, dur:1}, p.events[0])
  assert([{value:'1',_time:1, dur:1}], p.events[1].value({_time:1,dur:1},0))
  assert([{value:'2',_time:1, dur:1}], p.events[1].value({_time:1,dur:1},3))

  p = parsePattern('0<123><45>', 1/3)
  assert(1, p.length)
  assert({value:'0',_time:0, dur:1/3}, p.events[0])
  assert([{value:'1',_time:1/3, dur:1/3}], p.events[1].value({_time:1/3,dur:1/3},0))
  assert([{value:'4',_time:2/3, dur:1/3}], p.events[2].value({_time:2/3,dur:1/3},0))
  assert([{value:'2',_time:1/3, dur:1/3}], p.events[1].value({_time:1/3,dur:1/3},1))
  assert([{value:'5',_time:2/3, dur:1/3}], p.events[2].value({_time:2/3,dur:1/3},1))
  assert([{value:'3',_time:1/3, dur:1/3}], p.events[1].value({_time:1/3,dur:1/3},2))
  assert([{value:'4',_time:2/3, dur:1/3}], p.events[2].value({_time:2/3,dur:1/3},2))

  p = parsePattern('<1<23>4>', 1)
  assert(1, p.length)
  assert([{value:'1',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},0))
  assert([{value:'2',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},1))
  assert([{value:'4',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},2))
  assert([{value:'1',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},3))
  assert([{value:'3',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},4))
  assert([{value:'4',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},5))
  assert([{value:'1',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},6))

  p = parsePattern('<1<2<34>>>', 1)
  assert(1, p.length)
  assert([{value:'1',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},0))
  assert([{value:'2',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},1))
  assert([{value:'1',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},2))
  assert([{value:'3',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},3))
  assert([{value:'1',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},4))
  assert([{value:'2',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},5))
  assert([{value:'1',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},6))
  assert([{value:'4',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},7))
  assert([{value:'1',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},8))

  p = parsePattern('<0.>', 1)
  assert(1, p.length)
  assert([{value:'0',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},0))
  assert([{_time:0,dur:1}], p.events[0].value({_time:0,dur:1},1))
  assert([{value:'0',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},2))

  p = parsePattern('<1[23]>', 1)
  assert(1, p.length)
  assert([{value:'1',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},0))
  assert([{value:'2',_time:0, dur:1/2},{value:'3',_time:1/2, dur:1/2}], p.events[0].value({_time:0,dur:1},1))
  assert([{value:'1',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},2))

  p = parsePattern('[1<23>]', 1)
  assert(1, p.length)
  assert({value:'1',_time:0, dur:1/2}, p.events[0])
  assert([{value:'2',_time:1/2, dur:1/2}], p.events[1].value({_time:0.5,dur:0.5},0))
  assert([{value:'3',_time:1/2, dur:1/2}], p.events[1].value({_time:0.5,dur:0.5},1))

  p = parsePattern('(1<23>)', 1)
  assert(1, p.length)
  assert({value:'1',_time:0, dur:1}, p.events[0])
  assert([{value:'2',_time:0, dur:1}], p.events[1].value({_time:0,dur:1},0))
  assert([{value:'3',_time:0, dur:1}], p.events[1].value({_time:0,dur:1},1))

  p = parsePattern('<1(23)>', 1)
  assert(1, p.length)
  assert([{value:'1',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},0))
  assert([{value:'2',_time:0, dur:1},{value:'3',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},1))

  p = parsePattern('<[1(23)]>', 1)
  assert(1, p.length)
  assert([{value:'1',_time:0, dur:1/2},{value:'2',_time:1/2, dur:1/2},{value:'3',_time:1/2, dur:1/2}], p.events[0].value({_time:0,dur:1},0))

  p = parsePattern('<1<.3>>_', 1)
  assert(2, p.length)
  assert([{value:'1',_time:0, dur:2}], p.events[0].value({_time:0,dur:2},0))
  assert([{_time:0, dur:2}], p.events[0].value({_time:0,dur:2},1))
  assert([{value:'1',_time:0, dur:2}], p.events[0].value({_time:0,dur:2},2))
  assert([{value:'3',_time:0, dur:2}], p.events[0].value({_time:0,dur:2},3))

  p = parsePattern('<1[2<34>]>', 1)
  assert(1, p.length)
  assert([{value:'1',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},0))
  assert([{value:'2',_time:0, dur:1/2},{value:'3',_time:1/2, dur:1/2}], p.events[0].value({_time:0,dur:1},1))
  assert([{value:'1',_time:0, dur:1}], p.events[0].value({_time:0,dur:1},2))
  assert([{value:'2',_time:0, dur:1/2},{value:'4',_time:1/2, dur:1/2}], p.events[0].value({_time:0,dur:1},3))

  p = parsePattern('[1<2[34]>]', 1)
  assert(1, p.length)
  assert({value:'1',_time:0, dur:1/2}, p.events[0])
  assert([{value:'2',_time:1/2, dur:1/2}], p.events[1].value({_time:1/2,dur:1/2},0))
  assert([{value:'3',_time:1/2, dur:1/4},{value:'4',_time:3/4, dur:1/4}], p.events[1].value({_time:1/2,dur:1/2},1))

  p = parsePattern('(0<1[2<3[45]>]>)', 1)
  assert(1, p.length)
  assert({value:'0',_time:0, dur:1}, p.events[0])
  assert([{value:'1',_time:0, dur:1}], p.events[1].value({_time:0,dur:1},0))
  assert([{value:'2',_time:0, dur:1/2},{value:'3',_time:1/2, dur:1/2}], p.events[1].value({_time:0,dur:1},1))
  assert([{value:'1',_time:0, dur:1}], p.events[1].value({_time:0,dur:1},2))
  assert([{value:'2',_time:0, dur:1/2},{value:'4',_time:1/2, dur:1/4},{value:'5',_time:3/4, dur:1/4}], p.events[1].value({_time:0,dur:1},3))

  p = parsePattern('0#', 1)
  assert(1, p.length)
  assert({value:'0',_time:0,dur:1,sharp:1}, p.events[0])

  p = parsePattern('0#1', 1)
  assert(2, p.length)
  assert({value:'0',_time:0,dur:1,sharp:1}, p.events[0])
  assert({value:'1',_time:1,dur:1}, p.events[1])

  p = parsePattern('1#2#', 1)
  assert(2, p.length)
  assert({value:'1',_time:0,dur:1,sharp:1}, p.events[0])
  assert({value:'2',_time:1,dur:1, sharp:1}, p.events[1])

  assert({value:'-1',_time:0,dur:1,sharp:1}, parsePattern('-1#', 1).events[0])
  assert({value:'0',_time:0,dur:2,sharp:1}, parsePattern('0#_', 1).events[0])
  assert({value:'#',_time:0,dur:1}, parsePattern('#', 1).events[0])

  p = parsePattern('a#', 1)
  assert(2, p.length)
  assert({value:'a',_time:0,dur:1}, p.events[0])
  assert({value:'#',_time:1,dur:1}, p.events[1])

  assert([{value:'0',_time:0,dur:1,sharp:1}], parsePattern('<0#>', 1).events[0].value({_time:0,dur:1},0))

  assertPattern(1, [{value:'0',_time:0,dur:1,sharp:1}], parsePattern('[0#]', 1))
  assertPattern(1, [{value:'0',_time:0,dur:1,sharp:1}], parsePattern('(0#)', 1))

  assert({value:'0',_time:0,dur:1,sharp:-1}, parsePattern('0b', 1).events[0])

  p = parsePattern('0^', 1)
  assert(1, p.length)
  assert({value:'0',_time:0,dur:1,loud:3/2}, p.events[0])

  p = parsePattern('0^1', 1)
  assert(2, p.length)
  assert({value:'0',_time:0,dur:1,loud:3/2}, p.events[0])
  assert({value:'1',_time:1,dur:1}, p.events[1])

  p = parsePattern('1^2^', 1)
  assert(2, p.length)
  assert({value:'1',_time:0,dur:1,loud:3/2}, p.events[0])
  assert({value:'2',_time:1,dur:1, loud:3/2}, p.events[1])

  assert({value:'-1',_time:0,dur:1,loud:3/2}, parsePattern('-1^', 1).events[0])
  assert({value:'0',_time:0,dur:2,loud:3/2}, parsePattern('0^_', 1).events[0])
  assert({value:'^',_time:0,dur:1}, parsePattern('^', 1).events[0])

  p = parsePattern('a^', 1)
  assert(1, p.length)
  assert({value:'a',_time:0,dur:1,loud:3/2}, p.events[0])

  assert([{value:'0',_time:0,dur:1,loud:3/2}], parsePattern('<0^>', 1).events[0].value({_time:0,dur:1},0))

  assertPattern(1, [{value:'0',_time:0,dur:1,loud:3/2}], parsePattern('[0^]', 1))
  assertPattern(1, [{value:'0',_time:0,dur:1,loud:3/2}], parsePattern('(0^)', 1))

  assert({value:'0',_time:0,dur:1,loud:0.5}, parsePattern('0v', 1).events[0])

  p = parsePattern('0=', 1)
  assert(1, p.length)
  assert({value:'0',_time:0,dur:1,long:2}, p.events[0])

  p = parsePattern('0=1', 1)
  assert(2, p.length)
  assert({value:'0',_time:0,dur:1,long:2}, p.events[0])
  assert({value:'1',_time:1,dur:1}, p.events[1])

  p = parsePattern('1=2=', 1)
  assert(2, p.length)
  assert({value:'1',_time:0,dur:1,long:2}, p.events[0])
  assert({value:'2',_time:1,dur:1, long:2}, p.events[1])

  assert({value:'-1',_time:0,dur:1,long:2}, parsePattern('-1=', 1).events[0])
  assert({value:'0',_time:0,dur:2,long:2}, parsePattern('0=_', 1).events[0])
  assert({value:'=',_time:0,dur:1}, parsePattern('=', 1).events[0])

  p = parsePattern('a=', 1)
  assert(2, p.length)
  assert({value:'a',_time:0,dur:1}, p.events[0])
  assert({value:'=',_time:1,dur:1}, p.events[1])

  assert([{value:'0',_time:0,dur:1,long:2}], parsePattern('<0=>', 1).events[0].value({_time:0,dur:1},0))

  assertPattern(1, [{value:'0',_time:0,dur:1,long:2}], parsePattern('[0=]', 1))
  assertPattern(1, [{value:'0',_time:0,dur:1,long:2}], parsePattern('(0=)', 1))

  assert({value:'0',_time:0,dur:1,long:0.5}, parsePattern('0!', 1).events[0])

  p = parsePattern('0#^=', 1)
  assert(1, p.length)
  assert({value:'0',_time:0,dur:1,sharp:1,loud:3/2,long:2}, p.events[0])

  // p = parsePattern('<1[.3]>_', 1)
  // assert(2, p.length)
  // assert([{value:'1',_time:0, dur:2}], p.events[0].value({_time:0,dur:1},0))
  // assert([{value:'3',_time:1/2, dur:3/2}], p.events[0].value({_time:0,dur:1},1))

  // <.(12)>_
  // 0<1_>

  console.log("Parse pattern tests complete")
  }
  
  return parsePattern
});
