'use strict';
define(function(require) {
  let param = require('player/default-param')
  let parsePatternString = require('player/parse-pattern')
  let {evalParamFrame} = require('player/eval-param')

  let parsePattern = (patternStr, params, defaultDur, player) => {
    if (!patternStr) { return () => [] }
    let pattern = parsePatternString(patternStr)
    let events = pattern.events
    if (events.length == 0) { return () => [] }
    let dur = param(param(params.dur, defaultDur), 1)
    if (typeof dur === 'number') { // const duration, get events at time deterministically
      let patternLength = pattern.length * dur
      return (count) => {
        player._patternIdx = undefined
        player._patternStartCount = undefined
          let patternStartTime = patternLength * Math.floor(count / patternLength)
        let idx = 0
        let eventsForBeat = []
        let _time = 0
        let baseTime = 0
        do {
          let e = events[idx]
          let es = (typeof(e.value) == 'function') ? e.value(e, Math.floor(count/patternLength)) : [e]
          es.forEach(sourceEvent => {
            let event = {}
            event.value = sourceEvent.value
            event.idx = idx
            event._time = sourceEvent._time * dur
            _time = (patternStartTime + event._time) - count
            baseTime = _time
            event.dur = sourceEvent.dur * dur
            event._time = _time
            event.count = count+_time
            event.sharp = sourceEvent.sharp
            event.loud = sourceEvent.loud
            event.long = sourceEvent.long
            if (event.value !== '.' && baseTime > -0.0001 && baseTime < 0.9999) {
              for (let k in params) {
                if (k != '_time' && k != 'value' && k != 'dur') {
                  event[k] = params[k]
                }
              }
              eventsForBeat.push(event)
            }
          })
          idx += 1
          if (idx >= events.length) {
            idx = 0
            patternStartTime += patternLength
          }
        } while (baseTime < 1.0001)
        return eventsForBeat.filter(({value}) => value !== undefined)
      }
    } else { // non-const duration, step through events in realtime
      return (count) => {
        if (!player._patternIdx) { player._patternIdx = 0 }
        if (!player._patternStartCount) { player._patternStartCount = count }
        let eventsForBeat = []
        do {
          let e = events[player._patternIdx]
          let es = (typeof(e.value) == 'function') ? e.value(e, player._patternIdx) : [e]
          let duration = evalParamFrame(dur, {idx: player._patternIdx}, count)
          es.forEach(sourceEvent => {
            let event = {}
            event.value = sourceEvent.value
            event.idx = player._patternIdx // THIS IS WRONG! should be step idx, not events index?? Needs tests either way
            event._time = sourceEvent._time * duration
            event.dur = sourceEvent.dur * duration
            event.count = count + sourceEvent._time * duration
            event.sharp = sourceEvent.sharp
            event.loud = sourceEvent.loud
            event.long = sourceEvent.long
            if (event.value !== '.') {
              for (let k in params) {
                if (k != '_time' && k != 'value' && k != 'dur') {
                  event[k] = params[k]
                }
              }
              eventsForBeat.push(event)
            }
          })
          player._patternIdx++
          player._patternStartCount += duration
          if (player._patternIdx >= events.length) { player._patternIdx = 0 }
        } while (player._patternStartCount < count + 0.9999)
        return eventsForBeat.filter(({value}) => value !== undefined)
      }
    }
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  let pattern

  pattern = parsePattern('', {}, undefined, {})
  assert([], pattern(0))
  assert([], pattern(1))

  pattern = parsePattern('x', {}, undefined, {})
  assert([{value:'x',idx:0,_time:0,dur:1,count:0}], pattern(0))
  assert([{value:'x',idx:0,_time:0,dur:1,count:1}], pattern(1))

  pattern = parsePattern('xo', {}, undefined, {})
  assert([{value:'x',idx:0,_time:0,dur:1,count:0}], pattern(0))
  assert([{value:'o',idx:1,_time:0,dur:1,count:1}], pattern(1))
  assert([{value:'x',idx:0,_time:0,dur:1,count:2}], pattern(2))

  pattern = parsePattern('xo', {dur:1/2}, undefined, {})
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:0},{value:'o',idx:1,_time:1/2,dur:1/2,count:0.5}], pattern(0))
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:1},{value:'o',idx:1,_time:1/2,dur:1/2,count:1.5}], pattern(1))

  pattern = parsePattern('xo', {dur:()=>1/2}, undefined, {})
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:0},{value:'o',idx:1,_time:1/2,dur:1/2,count:0.5}], pattern(0))
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:1},{value:'o',idx:1,_time:1/2,dur:1/2,count:1.5}], pattern(1))
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:2},{value:'o',idx:1,_time:1/2,dur:1/2,count:2.5}], pattern(2))
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:3},{value:'o',idx:1,_time:1/2,dur:1/2,count:3.5}], pattern(3))

  // pattern = parsePattern('xo', {dur:({idx})=> idx%2 ? 1/4 : 1}, undefined, {})
  // assert([{value:'x',idx:0,_time:0,dur:1/2,count:0},{value:'o',idx:1,_time:1/2,dur:1/2,count:0.5}], pattern(0))

  pattern = parsePattern('-', {dur:1/4}, undefined, {})
  assert([{value:'-',idx:0,_time:0,dur:1/4,count:0},{value:'-',idx:0,_time:1/4,dur:1/4,count:1/4},{value:'-',idx:0,_time:2/4,dur:1/4,count:2/4},{value:'-',idx:0,_time:3/4,dur:1/4,count:3/4}], pattern(0))
  assert([{value:'-',idx:0,_time:0,dur:1/4,count:1},{value:'-',idx:0,_time:1/4,dur:1/4,count:5/4},{value:'-',idx:0,_time:2/4,dur:1/4,count:6/4},{value:'-',idx:0,_time:3/4,dur:1/4,count:7/4}], pattern(1))

  pattern = parsePattern('-', {dur:4/5}, undefined, {})
  assert([{value:'-',idx:0,_time:0,dur:4/5,count:0},{value:'-',idx:0,_time:4/5,dur:4/5,count:4/5}], pattern(0))
  assert([{value:'-',idx:0,_time:3/5,dur:4/5,count:8/5}], pattern(1))
  assert([{value:'-',idx:0,_time:2/5,dur:4/5,count:12/5}], pattern(2))
  assert([{value:'-',idx:0,_time:1/5,dur:4/5,count:16/5}], pattern(3))
  assert([{value:'-',idx:0,_time:0,dur:4/5,count:4},{value:'-',idx:0,_time:4/5,dur:4/5,count:24/5}], pattern(4))
  assert([{value:'-',idx:0,_time:3/5,dur:4/5,count:28/5}], pattern(5))

  pattern = parsePattern('xo', {dur:2}, undefined, {})
  assert([{value:'x',idx:0,_time:0,dur:2,count:0}], pattern(0))
  assert([], pattern(1))
  assert([{value:'o',idx:1,_time:0,dur:2,count:2}], pattern(2))
  assert([], pattern(3))
  assert([{value:'x',idx:0,_time:0,dur:2,count:4}], pattern(4))

  pattern = parsePattern('xo', {dur:3/2}, undefined, {})
  assert([{value:'x',idx:0,_time:0,dur:3/2,count:0}], pattern(0))
  assert([{value:'o',idx:1,_time:1/2,dur:3/2,count:3/2}], pattern(1))
  assert([], pattern(2))
  assert([{value:'x',idx:0,_time:0,dur:3/2,count:3}], pattern(3))

  pattern = parsePattern('xo', {dur:3}, undefined, {})
  assert([{value:'x',idx:0,_time:0,dur:3,count:0}], pattern(0))
  assert([], pattern(1))
  assert([], pattern(2))
  assert([{value:'o',idx:1,_time:0,dur:3,count:3}], pattern(3))
  assert([], pattern(4))
  assert([], pattern(5))
  assert([{value:'x',idx:0,_time:0,dur:3,count:6}], pattern(6))

  pattern = parsePattern('xo', {dur:2.5}, undefined, {})
  assert([{value:'x',idx:0,_time:0,dur:2.5,count:0}], pattern(0))
  assert([], pattern(1))
  assert([{value:'o',idx:1,_time:0.5,dur:2.5,count:2.5}], pattern(2))
  assert([], pattern(3))
  assert([], pattern(4))
  assert([{value:'x',idx:0,_time:0,dur:2.5,count:5}], pattern(5))

  pattern = parsePattern('=--.--', {dur:1/3}, undefined, {})
  assert([{value:'=',idx:0,_time:0,dur:1/3,count:0},{value:'-',idx:1,_time:1/3,dur:1/3,count:1/3},{value:'-',idx:2,_time:2/3,dur:1/3,count:2/3}], pattern(0))
  assert([{value:'-',idx:4,_time:1/3,dur:1/3,count:4/3},{value:'-',idx:5,_time:2/3,dur:1/3,count:5/3}], pattern(1))
  assert([{value:'=',idx:0,_time:0,dur:1/3,count:6/3},{value:'-',idx:1,_time:1/3,dur:1/3,count:7/3},{value:'-',idx:2,_time:2/3,dur:1/3,count:8/3}], pattern(2))

  pattern = parsePattern('[xo]', {}, undefined, {})
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:0},{value:'o',idx:1,_time:1/2,dur:1/2,count:1/2}], pattern(0))
  assert([{value:'x',idx:0,_time:0,dur:1/2,count:1},{value:'o',idx:1,_time:1/2,dur:1/2,count:3/2}], pattern(1))

  pattern = parsePattern('[---]', {}, undefined, {})
  assert([{value:'-',idx:0,_time:0,dur:1/3,count:0},{value:'-',idx:1,_time:1/3,dur:1/3,count:1/3},{value:'-',idx:2,_time:2/3,dur:1/3,count:2/3}], pattern(0))
  assert([{value:'-',idx:0,_time:0,dur:1/3,count:1},{value:'-',idx:1,_time:1/3,dur:1/3,count:4/3},{value:'-',idx:2,_time:2/3,dur:1/3,count:5/3}], pattern(1))

  pattern = parsePattern('[--[--]-]', {}, undefined, {})
  assert([{value:'-',idx:0,_time:0,dur:1/4,count:0},{value:'-',idx:1,_time:1/4,dur:1/4,count:1/4},{value:'-',idx:2,_time:1/2,dur:1/8,count:1/2},{value:'-',idx:3,_time:5/8,dur:1/8,count:5/8},{value:'-',idx:4,_time:3/4,dur:1/4,count:3/4}], pattern(0))
  assert([{value:'-',idx:0,_time:0,dur:1/4,count:1},{value:'-',idx:1,_time:1/4,dur:1/4,count:5/4},{value:'-',idx:2,_time:1/2,dur:1/8,count:3/2},{value:'-',idx:3,_time:5/8,dur:1/8,count:13/8},{value:'-',idx:4,_time:3/4,dur:1/4,count:7/4}], pattern(1))

  pattern = parsePattern('[xo]', {dur:1/2}, undefined, {})
  assert([{value:'x',idx:0,_time:0,dur:1/4,count:0},{value:'o',idx:1,_time:1/4,dur:1/4,count:1/4},{value:'x',idx:0,_time:1/2,dur:1/4,count:2/4},{value:'o',idx:1,_time:3/4,dur:1/4,count:3/4}], pattern(0))
  assert([{value:'x',idx:0,_time:0,dur:1/4,count:1},{value:'o',idx:1,_time:1/4,dur:1/4,count:5/4},{value:'x',idx:0,_time:1/2,dur:1/4,count:6/4},{value:'o',idx:1,_time:3/4,dur:1/4,count:7/4}], pattern(1))

  pattern = parsePattern('[xo].', {dur:1/2}, undefined, {})
  assert([{value:'x',idx:0,_time:0,dur:1/4,count:0},{value:'o',idx:1,_time:1/4,dur:1/4,count:1/4}], pattern(0))
  assert([{value:'x',idx:0,_time:0,dur:1/4,count:1},{value:'o',idx:1,_time:1/4,dur:1/4,count:5/4}], pattern(1))

  pattern = parsePattern('012345', {dur:2}, undefined, {})
  for (let i = 0; i < 20; i++) {
    assert([{value:''+(i%6),idx:(i%6),_time:0,dur:2,count:2*i}], pattern(2*i))
    assert([], pattern(2*i+1))
  }

  pattern = parsePattern('0-1-2-x1', {}, undefined, {})
  assert([{value:'0',idx:0,_time:0,dur:1,count:0}], pattern(0))
  assert([{value:'-1',idx:1,_time:0,dur:1,count:1}], pattern(1))
  assert([{value:'-2',idx:2,_time:0,dur:1,count:2}], pattern(2))
  assert([{value:'-',idx:3,_time:0,dur:1,count:3}], pattern(3))
  assert([{value:'x',idx:4,_time:0,dur:1,count:4}], pattern(4))
  assert([{value:'1',idx:5,_time:0,dur:1,count:5}], pattern(5))

  pattern = parsePattern('0', {amp:2}, undefined, {})
  assert([{value:'0',idx:0,_time:0,dur:1,count:0,amp:2}], pattern(0))

  pattern = parsePattern('0', {delay:1/2}, undefined, {})
  assert([{value:'0',idx:0,_time:0,dur:1,count:0,delay:1/2}], pattern(0))

  pattern = parsePattern('0', {amp:[2,3]}, undefined, {})
  assert([{value:'0',idx:0,_time:0,dur:1,count:0,amp:[2,3]}], pattern(0))
  assert([{value:'0',idx:0,_time:0,dur:1,count:1,amp:[2,3]}], pattern(1))

  pattern = parsePattern('0_', {}, undefined, {})
  assert([{value:'0',idx:0,_time:0,dur:2,count:0}], pattern(0))
  assert([], pattern(1))
  assert([{value:'0',idx:0,_time:0,dur:2,count:2}], pattern(2))

  pattern = parsePattern('0[_1]', {}, undefined, {})
  assert([{value:'0',idx:0,_time:0,dur:1.5,count:0}], pattern(0))
  assert([{value:'1',idx:1,_time:1/2,dur:1/2,count:3/2}], pattern(1))
  assert([{value:'0',idx:0,_time:0,dur:1.5,count:2}], pattern(2))

  pattern = parsePattern('(xo)', {}, undefined, {})
  assert([{value:'x',idx:0,_time:0,dur:1,count:0},{value:'o',idx:1,_time:0,dur:1,count:0}], pattern(0))
  assert([{value:'x',idx:0,_time:0,dur:1,count:1},{value:'o',idx:1,_time:0,dur:1,count:1}], pattern(1))

  pattern = parsePattern('(01)_', {}, undefined, {})
  assert([{value:'0',idx:0,_time:0,dur:2,count:0},{value:'1',idx:1,_time:0,dur:2,count:0}], pattern(0))
  assert([], pattern(1))

  pattern = parsePattern('[.(24)]_', {}, undefined, {})
  assert([{value:'2',idx:1,_time:0.5,dur:1.5,count:1/2},{value:'4',idx:2,_time:0.5,dur:1.5,count:1/2}], pattern(0))
  assert([], pattern(1))

  pattern = parsePattern('x(o[--])', {}, undefined, {})
  assert([{value:'x',idx:0,_time:0,dur:1,count:0}], pattern(0))
  assert([{value:'o',idx:1,_time:0,dur:1,count:1},{value:'-',idx:2,_time:0,dur:0.5,count:1},{value:'-',idx:3,_time:0.5,dur:0.5,count:3/2}], pattern(1))
  assert([{value:'x',idx:0,_time:0,dur:1,count:2}], pattern(2))

  pattern = parsePattern('x([--]o)', {}, undefined, {})
  assert([{value:'x',idx:0,_time:0,dur:1,count:0}], pattern(0))
  assert([{value:'-',idx:1,_time:0,dur:0.5,count:1},{value:'o',idx:2,_time:0,dur:1,count:1},{value:'-',idx:3,_time:0.5,dur:0.5,count:3/2}], pattern(1))
  assert([{value:'x',idx:0,_time:0,dur:1,count:2}], pattern(2))

  pattern = parsePattern('<01>', {}, undefined, {})
  assert([{value:'0',idx:0,_time:0,dur:1,count:0}], pattern(0))
  assert([{value:'1',idx:0,_time:0,dur:1,count:1}], pattern(1))
  assert([{value:'0',idx:0,_time:0,dur:1,count:2}], pattern(2))

  pattern = parsePattern('<01><345>', {dur:1/2}, undefined, {})
  assert([{value:'0',idx:0,_time:0,dur:1/2,count:0},{value:'3',idx:1,_time:1/2,dur:1/2,count:1/2}], pattern(0))
  assert([{value:'1',idx:0,_time:0,dur:1/2,count:1},{value:'4',idx:1,_time:1/2,dur:1/2,count:3/2}], pattern(1))
  assert([{value:'0',idx:0,_time:0,dur:1/2,count:2},{value:'5',idx:1,_time:1/2,dur:1/2,count:5/2}], pattern(2))
  assert([{value:'1',idx:0,_time:0,dur:1/2,count:3},{value:'3',idx:1,_time:1/2,dur:1/2,count:7/2}], pattern(3))

  pattern = parsePattern('<1[23]>', {}, undefined, {})
  assert([{value:'1',idx:0,_time:0,dur:1,count:0}], pattern(0))
  assert([{value:'2',idx:0,_time:0,dur:1/2,count:1},{value:'3',idx:0,_time:1/2,dur:1/2,count:3/2}], pattern(1))
  assert([{value:'1',idx:0,_time:0,dur:1,count:2}], pattern(2))

  let evalPerFrame = ()=>1
  evalPerFrame.interval = 'frame'
  assert(1, parsePattern('0', {scroll:evalPerFrame}, undefined, {})(0)[0].scroll())

  pattern = parsePattern('(01)', {dur:1}, undefined, {})
  assert([{value:'0',idx:0,_time:0,dur:1,count:0},{value:'1',idx:1,_time:0,dur:1,count:0}], pattern(0))
  assert([{value:'0',idx:0,_time:0,dur:1,count:1},{value:'1',idx:1,_time:0,dur:1,count:1}], pattern(1))
  assert([{value:'0',idx:0,_time:0,dur:1,count:2},{value:'1',idx:1,_time:0,dur:1,count:2}], pattern(2))
  assert([{value:'0',idx:0,_time:0,dur:1,count:3},{value:'1',idx:1,_time:0,dur:1,count:3}], pattern(3))

  pattern = parsePattern('0#', {dur:1}, undefined, {})
  assert([{value:'0',idx:0,_time:0,dur:1,count:0,sharp:1}], pattern(0))

  pattern = parsePattern('0b', {dur:1}, undefined, {})
  assert([{value:'0',idx:0,_time:0,dur:1,count:0,sharp:-1}], pattern(0))

  pattern = parsePattern('0^', {dur:1}, undefined, {})
  assert([{value:'0',idx:0,_time:0,dur:1,count:0,loud:3/2}], pattern(0))

  pattern = parsePattern('0v', {dur:1}, undefined, {})
  assert([{value:'0',idx:0,_time:0,dur:1,count:0,loud:1/2}], pattern(0))

  pattern = parsePattern('0=', {dur:1}, undefined, {})
  assert([{value:'0',idx:0,_time:0,dur:1,count:0,long:2}], pattern(0))

  pattern = parsePattern('0!', {dur:1}, undefined, {})
  assert([{value:'0',idx:0,_time:0,dur:1,count:0,long:1/2}], pattern(0))

  console.log("Pattern tests complete")
  }
  
  return parsePattern
});
