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

  let def = (x,d) => x === undefined ? d : x

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
    // chord
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
          case '#': sharp = def(sharp,0) + 1;  break;
          case 'b': sharp = def(sharp,0) - 1;  break;
          case '^': loud = def(loud,1) * 1.5;  break;
          case 'v': loud = def(loud,1) * 0.5;  break;
          case '=': long = def(long,1) * 2;    break;
          case '!': long = def(long,1) * 0.5;  break;
          default : done = true; break;
        }
        if (!done) { state.idx += 1 }
      }
    } else {
      let done
      while (!done) {
        let nextChar = state.str.charAt(state.idx)
        if (nextChar == '^') { // Loud modifier works for non numeric pattern chars too
          loud = def(loud,1) * 1.5
        } else {
          done = true
        }
          if (!done) { state.idx += 1 }
      }

    }
    // console.log('event', state, 'value:', char, '_time:', _time, 'dur:', dur)
    let v = parseFloat(char)
    if (isNaN(v)) { v = char }
    events.push({
      value: v,
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
        if (result.length == 0) { throw 'Invalid pattern starting with _' }
        let lastTime = result[result.length-1]._time
        // console.log('continuation', event, 'lastTime', lastTime)
        result.filter(e => e._time == lastTime).forEach(e => e.dur += event.dur)
      } else {
        result.push(event)
      }
    })
    return result
  }

  let parsePattern = (patternStr) => {
    // console.log('*** parsePattern', patternStr)
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

    let events = []
    let patternCount = result.events.length
    let stepTime = 0
    if (patternCount > 0) {
      let patternLength = result.length
      let step = 0
      let patternIdx = 0
      while (step < patternLength) { // loop over events in entire pattern
        let currentStep = result.events[patternIdx].step
        while (result.events[patternIdx].step == currentStep) { // loop over events in step
          let event = result.events[patternIdx]
          events.push({
            value:event.value,
            _time:stepTime + (event._time-event.step),
            dur:event.dur,
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
        stepTime += 1
        step++
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
  let assertThrows = (expected, code) => {
    let got
    try {code()}
    catch (e) { if (e.includes(expected)) {got=true} else {console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: ${e}`)} }
    finally { if (!got) console.trace(`Assertion failed.\n>>Expected throw: ${expected}\n>>Actual: none` ) }
  }

  assertPattern(0, [], parsePattern(''))
  assertPattern(0, [], parsePattern('[]'))

  assertPattern(1, [
    {value:'x',_time:0, dur:1},
  ], parsePattern('x'))

  assertPattern(2, [
    {value:'x',_time:0, dur:1},
    {value:'o',_time:1, dur:1},
  ], parsePattern('xo'))

  assertPattern(3, [
    {value:'x',_time:0, dur:1},
    {value:'-',_time:1, dur:1},
    {value:'o',_time:2, dur:1},
  ], parsePattern('x-o'))

  assertPattern(2, [
    {_time:0,dur:1},
    {value:'x',_time:1, dur:1},
  ], parsePattern('.x'))

  assertPattern(2, [
    {value:'x',_time:0, dur:1},
    {_time:1,dur:1},
  ], parsePattern('x.'))

  assertPattern(1, [
    {value:'x',_time:0, dur:1/2},
    {value:'o',_time:1/2, dur:1/2},
  ], parsePattern('[xo]'))

  assertPattern(1, [
    {value:0,_time:0, dur:1/2},
    {value:1,_time:1/2, dur:1/4},
    {value:2,_time:3/4, dur:1/4},
  ], parsePattern('[0[12]]'))

  assertPattern(2, [
    {value:0,_time:0, dur:2},
  ], parsePattern('0_'))

  assertThrows('Invalid pattern starting with _', ()=>parsePattern('_0'))

  assertPattern(3, [
    {value:0,_time:0, dur:3/2},
    {value:1,_time:3/2, dur:3/2},
  ], parsePattern('0[_1]_'))

  assertPattern(2, [
    {value:0,_time:0, dur:2},
  ], parsePattern('[0_]_'))

  assertPattern(1, [
    {value:'x',_time:0, dur:1},
    {value:'o',_time:0, dur:1},
  ], parsePattern('(xo)'))

  assertPattern(2, [
    {value:0,_time:0, dur:2},
    {value:1,_time:0, dur:2},
  ], parsePattern('(01)_'))

  assertPattern(2, [
    {value:'x',_time:0, dur:1},
    {value:'o',_time:1, dur:1},
    {value:'-',_time:1, dur:1/2},
    {value:'-',_time:3/2, dur:1/2},
  ], parsePattern('x(o[--])'))

  assertPattern(2, [
    {value:'x',_time:0, dur:1},
    {value:'-',_time:1, dur:1/2},
    {value:'o',_time:1, dur:1},
    {value:'-',_time:3/2, dur:1/2},
  ], parsePattern('x([--]o)'))

  let p

  p = parsePattern('<>')
  assert(1, p.length)
  assert([], p.events[0].value({_time:1,dur:1},0))
  assert([], p.events[0].value({_time:1,dur:1},1))

  p = parsePattern('<0>')
  assert(1, p.length)
  assert([{value:0,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},0))
  assert([{value:0,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},1))

  p = parsePattern('0<1>')
  assert(2, p.length)
  assert({value:0,_time:0, dur:1}, p.events[0])
  assert([{value:1,_time:1, dur:1}], p.events[1].value({_time:1,dur:1},0))
  assert([{value:1,_time:1, dur:1}], p.events[1].value({_time:1,dur:1},1))

  p = parsePattern('0<12>')
  assert(2, p.length)
  assert({value:0,_time:0, dur:1}, p.events[0])
  assert([{value:1,_time:1, dur:1}], p.events[1].value({_time:1,dur:1},0))
  assert([{value:2,_time:1, dur:1}], p.events[1].value({_time:1,dur:1},3))

  p = parsePattern('<1<23>4>')
  assert(1, p.length)
  assert([{value:1,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},0))
  assert([{value:2,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},1))
  assert([{value:4,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},2))
  assert([{value:1,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},3))
  assert([{value:3,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},4))
  assert([{value:4,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},5))
  assert([{value:1,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},6))

  p = parsePattern('<1<2<34>>>')
  assert(1, p.length)
  assert([{value:1,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},0))
  assert([{value:2,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},1))
  assert([{value:1,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},2))
  assert([{value:3,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},3))
  assert([{value:1,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},4))
  assert([{value:2,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},5))
  assert([{value:1,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},6))
  assert([{value:4,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},7))
  assert([{value:1,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},8))

  p = parsePattern('<0.>')
  assert(1, p.length)
  assert([{value:0,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},0))
  assert([{_time:0,dur:1}], p.events[0].value({_time:0,dur:1},1))
  assert([{value:0,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},2))

  p = parsePattern('<1[23]>')
  assert(1, p.length)
  assert([{value:1,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},0))
  assert([{value:2,_time:0, dur:1/2},{value:3,_time:1/2, dur:1/2}], p.events[0].value({_time:0,dur:1},1))
  assert([{value:1,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},2))

  p = parsePattern('[1<23>]')
  assert(1, p.length)
  assert({value:1,_time:0, dur:1/2}, p.events[0])
  assert([{value:2,_time:1/2, dur:1/2}], p.events[1].value({_time:0.5,dur:0.5},0))
  assert([{value:3,_time:1/2, dur:1/2}], p.events[1].value({_time:0.5,dur:0.5},1))

  p = parsePattern('(1<23>)')
  assert(1, p.length)
  assert({value:1,_time:0, dur:1}, p.events[0])
  assert([{value:2,_time:0, dur:1}], p.events[1].value({_time:0,dur:1},0))
  assert([{value:3,_time:0, dur:1}], p.events[1].value({_time:0,dur:1},1))

  p = parsePattern('<1(23)>')
  assert(1, p.length)
  assert([{value:1,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},0))
  assert([{value:2,_time:0, dur:1},{value:3,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},1))

  p = parsePattern('<[1(23)]>')
  assert(1, p.length)
  assert([{value:1,_time:0, dur:1/2},{value:2,_time:1/2, dur:1/2},{value:3,_time:1/2, dur:1/2}], p.events[0].value({_time:0,dur:1},0))

  p = parsePattern('<1<.3>>_')
  assert(2, p.length)
  assert([{value:1,_time:0, dur:2}], p.events[0].value({_time:0,dur:2},0))
  assert([{_time:0, dur:2}], p.events[0].value({_time:0,dur:2},1))
  assert([{value:1,_time:0, dur:2}], p.events[0].value({_time:0,dur:2},2))
  assert([{value:3,_time:0, dur:2}], p.events[0].value({_time:0,dur:2},3))

  p = parsePattern('<1[2<34>]>')
  assert(1, p.length)
  assert([{value:1,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},0))
  assert([{value:2,_time:0, dur:1/2},{value:3,_time:1/2, dur:1/2}], p.events[0].value({_time:0,dur:1},1))
  assert([{value:1,_time:0, dur:1}], p.events[0].value({_time:0,dur:1},2))
  assert([{value:2,_time:0, dur:1/2},{value:4,_time:1/2, dur:1/2}], p.events[0].value({_time:0,dur:1},3))

  p = parsePattern('[1<2[34]>]')
  assert(1, p.length)
  assert({value:1,_time:0, dur:1/2}, p.events[0])
  assert([{value:2,_time:1/2, dur:1/2}], p.events[1].value({_time:1/2,dur:1/2},0))
  assert([{value:3,_time:1/2, dur:1/4},{value:4,_time:3/4, dur:1/4}], p.events[1].value({_time:1/2,dur:1/2},1))

  p = parsePattern('(0<1[2<3[45]>]>)')
  assert(1, p.length)
  assert({value:0,_time:0, dur:1}, p.events[0])
  assert([{value:1,_time:0, dur:1}], p.events[1].value({_time:0,dur:1},0))
  assert([{value:2,_time:0, dur:1/2},{value:3,_time:1/2, dur:1/2}], p.events[1].value({_time:0,dur:1},1))
  assert([{value:1,_time:0, dur:1}], p.events[1].value({_time:0,dur:1},2))
  assert([{value:2,_time:0, dur:1/2},{value:4,_time:1/2, dur:1/4},{value:5,_time:3/4, dur:1/4}], p.events[1].value({_time:0,dur:1},3))

  p = parsePattern('0#')
  assert(1, p.length)
  assert({value:0,_time:0,dur:1,sharp:1}, p.events[0])

  p = parsePattern('0#1')
  assert(2, p.length)
  assert({value:0,_time:0,dur:1,sharp:1}, p.events[0])
  assert({value:1,_time:1,dur:1}, p.events[1])

  p = parsePattern('1#2#')
  assert(2, p.length)
  assert({value:1,_time:0,dur:1,sharp:1}, p.events[0])
  assert({value:2,_time:1,dur:1, sharp:1}, p.events[1])

  assert({value:-1,_time:0,dur:1,sharp:1}, parsePattern('-1#', 1).events[0])
  assert({value:0,_time:0,dur:2,sharp:1}, parsePattern('0#_', 1).events[0])
  assert({value:'#',_time:0,dur:1}, parsePattern('#', 1).events[0])

  p = parsePattern('a#')
  assert(2, p.length)
  assert({value:'a',_time:0,dur:1}, p.events[0])
  assert({value:'#',_time:1,dur:1}, p.events[1])

  assert([{value:0,_time:0,dur:1,sharp:1}], parsePattern('<0#>').events[0].value({_time:0,dur:1},0))

  assertPattern(1, [{value:0,_time:0,dur:1,sharp:1}], parsePattern('[0#]', 1))
  assertPattern(1, [{value:0,_time:0,dur:1,sharp:1}], parsePattern('(0#)', 1))

  assert({value:0,_time:0,dur:1,sharp:-1}, parsePattern('0b').events[0])

  p = parsePattern('0^')
  assert(1, p.length)
  assert({value:0,_time:0,dur:1,loud:3/2}, p.events[0])

  p = parsePattern('0^1')
  assert(2, p.length)
  assert({value:0,_time:0,dur:1,loud:3/2}, p.events[0])
  assert({value:1,_time:1,dur:1}, p.events[1])

  p = parsePattern('1^2^')
  assert(2, p.length)
  assert({value:1,_time:0,dur:1,loud:3/2}, p.events[0])
  assert({value:2,_time:1,dur:1, loud:3/2}, p.events[1])

  assert({value:-1,_time:0,dur:1,loud:3/2}, parsePattern('-1^').events[0])
  assert({value:0,_time:0,dur:2,loud:3/2}, parsePattern('0^_').events[0])
  assert({value:'^',_time:0,dur:1}, parsePattern('^').events[0])

  p = parsePattern('a^')
  assert(1, p.length)
  assert({value:'a',_time:0,dur:1,loud:3/2}, p.events[0])

  p = parsePattern('a^^')
  assert(1, p.length)
  assert({value:'a',_time:0,dur:1,loud:9/4}, p.events[0])

  assert([{value:0,_time:0,dur:1,loud:3/2}], parsePattern('<0^>').events[0].value({_time:0,dur:1},0))

  assertPattern(1, [{value:0,_time:0,dur:1,loud:3/2}], parsePattern('[0^]'))
  assertPattern(1, [{value:0,_time:0,dur:1,loud:3/2}], parsePattern('(0^)'))

  assert({value:0,_time:0,dur:1,loud:0.5}, parsePattern('0v').events[0])

  p = parsePattern('0=')
  assert(1, p.length)
  assert({value:0,_time:0,dur:1,long:2}, p.events[0])

  p = parsePattern('0=1')
  assert(2, p.length)
  assert({value:0,_time:0,dur:1,long:2}, p.events[0])
  assert({value:1,_time:1,dur:1}, p.events[1])

  p = parsePattern('1=2=')
  assert(2, p.length)
  assert({value:1,_time:0,dur:1,long:2}, p.events[0])
  assert({value:2,_time:1,dur:1, long:2}, p.events[1])

  assert({value:-1,_time:0,dur:1,long:2}, parsePattern('-1=').events[0])
  assert({value:0,_time:0,dur:2,long:2}, parsePattern('0=_').events[0])
  assert({value:'=',_time:0,dur:1}, parsePattern('=').events[0])

  p = parsePattern('a=')
  assert(2, p.length)
  assert({value:'a',_time:0,dur:1}, p.events[0])
  assert({value:'=',_time:1,dur:1}, p.events[1])

  assert([{value:0,_time:0,dur:1,long:2}], parsePattern('<0=>').events[0].value({_time:0,dur:1},0))

  assertPattern(1, [{value:0,_time:0,dur:1,long:2}], parsePattern('[0=]'))
  assertPattern(1, [{value:0,_time:0,dur:1,long:2}], parsePattern('(0=)'))

  assert({value:0,_time:0,dur:1,long:0.5}, parsePattern('0!').events[0])
  assert({value:0,_time:0,dur:1,long:0.25}, parsePattern('0!!').events[0])

  p = parsePattern('0^^')
  assert(1, p.length)
  assert({value:0,_time:0,dur:1,loud:9/4}, p.events[0])

  p = parsePattern('0#^=')
  assert(1, p.length)
  assert({value:0,_time:0,dur:1,sharp:1,loud:3/2,long:2}, p.events[0])

  // p = parsePattern('<1[.3]>_')
  // assert(2, p.length)
  // assert([{value:1,_time:0, dur:2}], p.events[0].value({_time:0,dur:1},0))
  // assert([{value:3,_time:1/2, dur:3/2}], p.events[0].value({_time:0,dur:1},1))

  // <.(12)>_
  // 0<1_>

  console.log("Parse pattern tests complete")
  }
  
  return parsePattern
});
