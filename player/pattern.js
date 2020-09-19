'use strict';
define(function(require) {
  let evalParam = require('player/eval-param').evalParamEvent
  let param = require('player/default-param')
  let parsePatternString = require('player/parse-pattern')

  let debug = false

  let multiplyEvents = (event) => {
    for (let k in event) {
      let v = event[k]
      if (Array.isArray(v)) {
        return v.flatMap(x => {
          let e = Object.assign({}, event)
          e[k] = x
          return multiplyEvents(e)
        })
      }
    }
    return [event]
  }

  let parsePattern = (pattern, params, defaultDur) => {
    if (debug) { console.log('*** pattern ', pattern) }
    if (!pattern) { return () => [] }
    let dur = param(param(params.dur, defaultDur), 1)
    let result = parsePatternString(pattern, dur)
    let patternLength = result.length
    let events = result.events
    if (debug) { console.log('events:', events, 'patternLength:', patternLength) }
    return (count) => {
      if (events.length == 0) { return [] }
      let patternStartTime = patternLength * Math.floor(count / patternLength)
      let patternBeat = count * patternLength / events.length
      if (debug) { console.log('play patternLength:', patternLength, 'patternStartTime:', patternStartTime, 'patternBeat: ', patternBeat) }
      let idx = 0
      let eventsForBeat = []
      let time = 0
      do {
        let e = events[idx]
        let es = (typeof(e.value) == 'function') ? e.value(e, Math.floor(count/patternLength)) : [e]
        es.forEach(sourceEvent => {
          let event = {}
          event.value = sourceEvent.value
          event.delay = evalParam(params.delay, idx, count)
          event.time = sourceEvent.time + (event.delay || 0)
          time = (patternStartTime + event.time) - count
          if (event.value !== '.' && time > -0.0001 && time < 0.9999) {
            for (let k in params) {
              if (k != 'time' && k != 'delay' && k != 'value') {
                event[k] = evalParam(params[k], idx, count+time)
              }
            }
            event.dur = sourceEvent.dur
            event.time = time
            event.idx = idx
            event.count = count+time
            if (debug) { console.log('play event:', event) }
            Array.prototype.push.apply(eventsForBeat, multiplyEvents(event))
          }
        })
        idx += 1
        if (idx >= events.length) {
          idx = 0
          patternStartTime += patternLength
        }
      } while (time < 1.0001)
      return eventsForBeat.filter(({value}) => value !== undefined)
    }
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  let pattern

  pattern = parsePattern('', {})
  assert([], pattern(0))
  assert([], pattern(1))

  pattern = parsePattern('x', {})
  assert([{value:'x',time:0,dur:1,idx:0,count:0}], pattern(0))
  assert([{value:'x',time:0,dur:1,idx:0,count:1}], pattern(1))

  pattern = parsePattern('xo', {})
  assert([{value:'x',time:0,dur:1,idx:0,count:0}], pattern(0))
  assert([{value:'o',time:0,dur:1,idx:1,count:1}], pattern(1))
  assert([{value:'x',time:0,dur:1,idx:0,count:2}], pattern(2))

  pattern = parsePattern('xo', {dur:1/2})
  assert([{value:'x',time:0,dur:1/2,idx:0,count:0},{value:'o',time:1/2,dur:1/2,idx:1,count:0.5}], pattern(0))
  assert([{value:'x',time:0,dur:1/2,idx:0,count:1},{value:'o',time:1/2,dur:1/2,idx:1,count:1.5}], pattern(1))

  pattern = parsePattern('-', {dur:1/4})
  assert([{value:'-',time:0,dur:1/4,idx:0,count:0},{value:'-',time:1/4,dur:1/4,idx:0,count:1/4},{value:'-',time:2/4,dur:1/4,idx:0,count:2/4},{value:'-',time:3/4,dur:1/4,idx:0,count:3/4}], pattern(0))
  assert([{value:'-',time:0,dur:1/4,idx:0,count:1},{value:'-',time:1/4,dur:1/4,idx:0,count:5/4},{value:'-',time:2/4,dur:1/4,idx:0,count:6/4},{value:'-',time:3/4,dur:1/4,idx:0,count:7/4}], pattern(1))

  pattern = parsePattern('-', {dur:4/5})
  assert([{value:'-',time:0,dur:4/5,idx:0,count:0},{value:'-',time:4/5,dur:4/5,idx:0,count:4/5}], pattern(0))
  assert([{value:'-',time:3/5,dur:4/5,idx:0,count:8/5}], pattern(1))
  assert([{value:'-',time:2/5,dur:4/5,idx:0,count:12/5}], pattern(2))
  assert([{value:'-',time:1/5,dur:4/5,idx:0,count:16/5}], pattern(3))
  assert([{value:'-',time:0,dur:4/5,idx:0,count:4},{value:'-',time:4/5,dur:4/5,idx:0,count:24/5}], pattern(4))
  assert([{value:'-',time:3/5,dur:4/5,idx:0,count:28/5}], pattern(5))

  pattern = parsePattern('xo', {dur:2})
  assert([{value:'x',time:0,dur:2,idx:0,count:0}], pattern(0))
  assert([], pattern(1))
  assert([{value:'o',time:0,dur:2,idx:1,count:2}], pattern(2))
  assert([], pattern(3))
  assert([{value:'x',time:0,dur:2,idx:0,count:4}], pattern(4))

  pattern = parsePattern('xo', {dur:3/2})
  assert([{value:'x',time:0,dur:3/2,idx:0,count:0}], pattern(0))
  assert([{value:'o',time:1/2,dur:3/2,idx:1,count:3/2}], pattern(1))
  assert([], pattern(2))
  assert([{value:'x',time:0,dur:3/2,idx:0,count:3}], pattern(3))

  pattern = parsePattern('xo', {dur:3})
  assert([{value:'x',time:0,dur:3,idx:0,count:0}], pattern(0))
  assert([], pattern(1))
  assert([], pattern(2))
  assert([{value:'o',time:0,dur:3,idx:1,count:3}], pattern(3))
  assert([], pattern(4))
  assert([], pattern(5))
  assert([{value:'x',time:0,dur:3,idx:0,count:6}], pattern(6))

  pattern = parsePattern('xo', {dur:2.5})
  assert([{value:'x',time:0,dur:2.5,idx:0,count:0}], pattern(0))
  assert([], pattern(1))
  assert([{value:'o',time:0.5,dur:2.5,idx:1,count:2.5}], pattern(2))
  assert([], pattern(3))
  assert([], pattern(4))
  assert([{value:'x',time:0,dur:2.5,idx:0,count:5}], pattern(5))

  pattern = parsePattern('=--.--', {dur:1/3})
  assert([{value:'=',time:0,dur:1/3,idx:0,count:0},{value:'-',time:1/3,dur:1/3,idx:1,count:1/3},{value:'-',time:2/3,dur:1/3,idx:2,count:2/3}], pattern(0))
  assert([{value:'-',time:1/3,dur:1/3,idx:4,count:4/3},{value:'-',time:2/3,dur:1/3,idx:5,count:5/3}], pattern(1))
  assert([{value:'=',time:0,dur:1/3,idx:0,count:6/3},{value:'-',time:1/3,dur:1/3,idx:1,count:7/3},{value:'-',time:2/3,dur:1/3,idx:2,count:8/3}], pattern(2))

  pattern = parsePattern('[xo]', {})
  assert([{value:'x',time:0,dur:1/2,idx:0,count:0},{value:'o',time:1/2,dur:1/2,idx:1,count:1/2}], pattern(0))
  assert([{value:'x',time:0,dur:1/2,idx:0,count:1},{value:'o',time:1/2,dur:1/2,idx:1,count:3/2}], pattern(1))

  pattern = parsePattern('[---]', {})
  assert([{value:'-',time:0,dur:1/3,idx:0,count:0},{value:'-',time:1/3,dur:1/3,idx:1,count:1/3},{value:'-',time:2/3,dur:1/3,idx:2,count:2/3}], pattern(0))
  assert([{value:'-',time:0,dur:1/3,idx:0,count:1},{value:'-',time:1/3,dur:1/3,idx:1,count:4/3},{value:'-',time:2/3,dur:1/3,idx:2,count:5/3}], pattern(1))

  pattern = parsePattern('[--[--]-]', {})
  assert([{value:'-',time:0,dur:1/4,idx:0,count:0},{value:'-',time:1/4,dur:1/4,idx:1,count:1/4},{value:'-',time:1/2,dur:1/8,idx:2,count:1/2},{value:'-',time:5/8,dur:1/8,idx:3,count:5/8},{value:'-',time:3/4,dur:1/4,idx:4,count:3/4}], pattern(0))
  assert([{value:'-',time:0,dur:1/4,idx:0,count:1},{value:'-',time:1/4,dur:1/4,idx:1,count:5/4},{value:'-',time:1/2,dur:1/8,idx:2,count:3/2},{value:'-',time:5/8,dur:1/8,idx:3,count:13/8},{value:'-',time:3/4,dur:1/4,idx:4,count:7/4}], pattern(1))

  pattern = parsePattern('[xo]', {dur:1/2})
  assert([{value:'x',time:0,dur:1/4,idx:0,count:0},{value:'o',time:1/4,dur:1/4,idx:1,count:1/4},{value:'x',time:1/2,dur:1/4,idx:0,count:2/4},{value:'o',time:3/4,dur:1/4,idx:1,count:3/4}], pattern(0))
  assert([{value:'x',time:0,dur:1/4,idx:0,count:1},{value:'o',time:1/4,dur:1/4,idx:1,count:5/4},{value:'x',time:1/2,dur:1/4,idx:0,count:6/4},{value:'o',time:3/4,dur:1/4,idx:1,count:7/4}], pattern(1))

  pattern = parsePattern('[xo].', {dur:1/2})
  assert([{value:'x',time:0,dur:1/4,idx:0,count:0},{value:'o',time:1/4,dur:1/4,idx:1,count:1/4}], pattern(0))
  assert([{value:'x',time:0,dur:1/4,idx:0,count:1},{value:'o',time:1/4,dur:1/4,idx:1,count:5/4}], pattern(1))

  pattern = parsePattern('012345', {dur:2})
  for (let i = 0; i < 20; i++) {
    assert([{value:''+(i%6),time:0,dur:2,idx:(i%6),count:2*i}], pattern(2*i))
    assert([], pattern(2*i+1))
  }

  pattern = parsePattern('0123', {dur:[1,2]})
  assert([{value:'0',time:0,dur:1,idx:0,count:0}], pattern(0))
  assert([{value:'1',time:0,dur:2,idx:1,count:1}], pattern(1))
  assert([], pattern(2))
  assert([{value:'2',time:0,dur:1,idx:2,count:3}], pattern(3))
  assert([{value:'3',time:0,dur:2,idx:3,count:4}], pattern(4))
  assert([], pattern(5))
  assert([{value:'0',time:0,dur:1,idx:0,count:6}], pattern(6))

  pattern = parsePattern('x', {dur:[1,1/2,1/2]})
  assert([{value:'x',time:0,dur:1,idx:0,count:0}], pattern(0))
  assert([{value:'x',time:0,dur:1/2,idx:1,count:1},{value:'x',time:1/2,dur:1/2,idx:2,count:3/2}], pattern(1))
  assert([{value:'x',time:0,dur:1,idx:0,count:2}], pattern(2))

  pattern = parsePattern('0-1-2-x1', {})
  assert([{value:'0',time:0,dur:1,idx:0,count:0}], pattern(0))
  assert([{value:'-1',time:0,dur:1,idx:1,count:1}], pattern(1))
  assert([{value:'-2',time:0,dur:1,idx:2,count:2}], pattern(2))
  assert([{value:'-',time:0,dur:1,idx:3,count:3}], pattern(3))
  assert([{value:'x',time:0,dur:1,idx:4,count:4}], pattern(4))
  assert([{value:'1',time:0,dur:1,idx:5,count:5}], pattern(5))

  pattern = parsePattern('0', {amp:2})
  assert([{value:'0',time:0,amp:2,dur:1,idx:0,count:0}], pattern(0))

  pattern = parsePattern('01', {amp:[2,3]})
  assert([{value:'0',time:0,amp:2,dur:1,idx:0,count:0}], pattern(0))
  assert([{value:'1',time:0,amp:3,dur:1,idx:1,count:1}], pattern(1))
  assert([{value:'0',time:0,amp:2,dur:1,idx:0,count:2}], pattern(2))

  pattern = parsePattern('0', {delay:1/2})
  assert([{value:'0',delay:1/2,time:1/2,dur:1,idx:0,count:1/2}], pattern(0))

  pattern = parsePattern('123', {delay:1})
//  assert([{value:'3',delay:1,time:0,dur:1,idx:2,count:0}], pattern(0))
  assert([{value:'1',delay:1,time:0,dur:1,idx:0,count:1}], pattern(1))
  assert([{value:'2',delay:1,time:0,dur:1,idx:1,count:2}], pattern(2))

  pattern = parsePattern('123', {delay:-1})
  assert([{value:'2',delay:-1,time:0,dur:1,idx:1,count:0}], pattern(0))
  assert([{value:'3',delay:-1,time:0,dur:1,idx:2,count:1}], pattern(1))
  assert([{value:'1',delay:-1,time:0,dur:1,idx:0,count:2}], pattern(2))

  pattern = parsePattern('0', {amp:()=>[2,3]})
  assert([{value:'0',time:0,amp:2,dur:1,idx:0,count:0},{value:'0',time:0,amp:3,dur:1,idx:0,count:0}], pattern(0))
  assert([{value:'0',time:0,amp:2,dur:1,idx:0,count:1},{value:'0',time:0,amp:3,dur:1,idx:0,count:1}], pattern(1))

  pattern = parsePattern('01', {amp:[()=>[1,2],()=>[3,4]]})
  assert([{value:'0',time:0,amp:1,dur:1,idx:0,count:0},{value:'0',time:0,amp:2,dur:1,idx:0,count:0}], pattern(0))
  assert([{value:'1',time:0,amp:3,dur:1,idx:1,count:1},{value:'1',time:0,amp:4,dur:1,idx:1,count:1}], pattern(1))
  assert([{value:'0',time:0,amp:1,dur:1,idx:0,count:2},{value:'0',time:0,amp:2,dur:1,idx:0,count:2}], pattern(2))

  pattern = parsePattern('0', {amp:()=>[2,3],dur:2,decay:1})
  assert([{value:'0',time:0,amp:2,dur:2,decay:1,idx:0,count:0},{value:'0',time:0,amp:3,dur:2,decay:1,idx:0,count:0}], pattern(0))
  assert([], pattern(1))
  assert([{value:'0',time:0,amp:2,dur:2,decay:1,idx:0,count:2},{value:'0',time:0,amp:3,dur:2,decay:1,idx:0,count:2}], pattern(2))

  pattern = parsePattern('0', {amp:()=>[2,3],decay:()=>[4,5]})
  assert([{value:'0',time:0,amp:2,decay:4,dur:1,idx:0,count:0},{value:'0',time:0,amp:2,decay:5,dur:1,idx:0,count:0},{value:'0',time:0,amp:3,decay:4,dur:1,idx:0,count:0},{value:'0',time:0,amp:3,decay:5,dur:1,idx:0,count:0}], pattern(0))

  // pattern = parsePattern('0', {delay:()=>[0,1/2]})
  // assert([{value:'0',time:0,delay:0,dur:1,idx:0,count:0},{value:'0',time:1/2,delay:1/2,dur:1,idx:0,count:1/2}], pattern(0))
  // assert([{value:'0',time:0,delay:0,dur:1,idx:0,count:1},{value:'0',time:1/2,delay:1/2,dur:1,idx:0,count:3/2}], pattern(1))

  pattern = parsePattern('0', {amp:(_,x)=>x%3})
  assert([{value:'0',time:0,amp:0,dur:1,idx:0,count:0}], pattern(0))
  assert([{value:'0',time:0,amp:1,dur:1,idx:0,count:1}], pattern(1))
  assert([{value:'0',time:0,amp:2,dur:1,idx:0,count:2}], pattern(2))
  assert([{value:'0',time:0,amp:0,dur:1,idx:0,count:3}], pattern(3))

  pattern = parsePattern('0', {amp:(_,x)=>[0,1]})
  assert([{value:'0',time:0,amp:0,dur:1,idx:0,count:0},{value:'0',time:0,amp:1,dur:1,idx:0,count:0}], pattern(0))
  assert([{value:'0',time:0,amp:0,dur:1,idx:0,count:1},{value:'0',time:0,amp:1,dur:1,idx:0,count:1}], pattern(1))

  pattern = parsePattern('0_', {})
  assert([{value:'0',time:0,dur:2,idx:0,count:0}], pattern(0))
  assert([], pattern(1))
  assert([{value:'0',time:0,dur:2,idx:0,count:2}], pattern(2))

  pattern = parsePattern('0[_1]', {})
  assert([{value:'0',time:0,dur:1.5,idx:0,count:0}], pattern(0))
  assert([{value:'1',time:1/2,dur:1/2,idx:1,count:3/2}], pattern(1))
  assert([{value:'0',time:0,dur:1.5,idx:0,count:2}], pattern(2))

  pattern = parsePattern('(xo)', {})
  assert([{value:'x',time:0,dur:1,idx:0,count:0},{value:'o',time:0,dur:1,idx:1,count:0}], pattern(0))
  assert([{value:'x',time:0,dur:1,idx:0,count:1},{value:'o',time:0,dur:1,idx:1,count:1}], pattern(1))

  pattern = parsePattern('(01)_', {})
  assert([{value:'0',time:0,dur:2,idx:0,count:0},{value:'1',time:0,dur:2,idx:1,count:0}], pattern(0))
  assert([], pattern(1))

  pattern = parsePattern('[.(24)]_', {})
  assert([{value:'2',time:0.5,dur:1.5,idx:1,count:1/2},{value:'4',time:0.5,dur:1.5,idx:2,count:1/2}], pattern(0))
  assert([], pattern(1))

  pattern = parsePattern('x(o[--])', {})
  assert([{value:'x',time:0,dur:1,idx:0,count:0}], pattern(0))
  assert([{value:'o',time:0,dur:1,idx:1,count:1},{value:'-',time:0,dur:0.5,idx:2,count:1},{value:'-',time:0.5,dur:0.5,idx:3,count:3/2}], pattern(1))
  assert([{value:'x',time:0,dur:1,idx:0,count:2}], pattern(2))

  pattern = parsePattern('x([--]o)', {})
  assert([{value:'x',time:0,dur:1,idx:0,count:0}], pattern(0))
  assert([{value:'-',time:0,dur:0.5,idx:1,count:1},{value:'o',time:0,dur:1,idx:2,count:1},{value:'-',time:0.5,dur:0.5,idx:3,count:3/2}], pattern(1))
  assert([{value:'x',time:0,dur:1,idx:0,count:2}], pattern(2))

  pattern = parsePattern('<01>', {})
  assert([{value:'0',time:0,dur:1,idx:0,count:0}], pattern(0))
  assert([{value:'1',time:0,dur:1,idx:0,count:1}], pattern(1))
  assert([{value:'0',time:0,dur:1,idx:0,count:2}], pattern(2))

  pattern = parsePattern('<01><345>', {dur:1/2})
  assert([{value:'0',time:0,dur:1/2,idx:0,count:0},{value:'3',time:1/2,dur:1/2,idx:1,count:1/2}], pattern(0))
  assert([{value:'1',time:0,dur:1/2,idx:0,count:1},{value:'4',time:1/2,dur:1/2,idx:1,count:3/2}], pattern(1))
  assert([{value:'0',time:0,dur:1/2,idx:0,count:2},{value:'5',time:1/2,dur:1/2,idx:1,count:5/2}], pattern(2))
  assert([{value:'1',time:0,dur:1/2,idx:0,count:3},{value:'3',time:1/2,dur:1/2,idx:1,count:7/2}], pattern(3))

  pattern = parsePattern('<1[23]>', {})
  assert([{value:'1',time:0,dur:1,idx:0,count:0}], pattern(0))
  assert([{value:'2',time:0,dur:1/2,idx:0,count:1},{value:'3',time:1/2,dur:1/2,idx:0,count:3/2}], pattern(1))
  assert([{value:'1',time:0,dur:1,idx:0,count:2}], pattern(2))

  let evalPerFrame = ()=>1
  evalPerFrame.interval = 'frame'
  assert(1, parsePattern('0', {scroll:evalPerFrame})(0)[0].scroll())

  console.log("Pattern tests complete")

  return parsePattern
});
