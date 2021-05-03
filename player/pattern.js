'use strict';
define(function(require) {
  let {evalParamEvent,evalParamToTuple} = require('player/eval-param')
  let param = require('player/default-param')
  let parsePatternString = require('player/parse-pattern')

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
    if (!pattern) { return () => [] }
    let dur = param(param(params.dur, defaultDur), 1)
    let result = parsePatternString(pattern, dur)
    let patternLength = result.length
    let events = result.events
    return (count) => {
      if (events.length == 0) { return [] }
      let patternStartTime = patternLength * Math.floor(count / patternLength)
      let idx = 0
      let eventsForBeat = []
      let time = 0
      let baseTime = 0
      do {
        let e = events[idx]
        let es = (typeof(e.value) == 'function') ? e.value(e, Math.floor(count/patternLength)) : [e]
        es.forEach(sourceEvent => {
          let delay = evalParamEvent(params.delay, event, count)
          let delays = Array.isArray(delay) ? delay : [delay]
          delays.forEach(d => {
            let event = {}
            event.value = sourceEvent.value
            event.idx = idx
            event.delay = d
            event.time = sourceEvent.time + (event.delay || 0)
            time = (patternStartTime + event.time) - count
            baseTime = time - (event.delay || 0)
            event.dur = sourceEvent.dur
            event.time = time
            event.count = count+time
            event.sharp = sourceEvent.sharp
            if (event.value !== '.' && baseTime > -0.0001 && baseTime < 0.9999) {
              for (let k in params) {
                if (k != 'time' && k != 'delay' && k != 'value' && k != 'dur') {
                  let v = evalParamToTuple(params[k], event, event.count)
                  if (Array.isArray(v)) { // If its a tuple, it must be handled per event
                    event[k] = v
                  } else {
                    event[k] = evalParamEvent(params[k], event, event.count)
                  }
                }
              }
              Array.prototype.push.apply(eventsForBeat, multiplyEvents(event))
            }
          })
        })
        idx += 1
        if (idx >= events.length) {
          idx = 0
          patternStartTime += patternLength
        }
      } while (baseTime < 1.0001)
      return eventsForBeat.filter(({value}) => value !== undefined)
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

  pattern = parsePattern('', {})
  assert([], pattern(0))
  assert([], pattern(1))

  pattern = parsePattern('x', {})
  assert([{value:'x',idx:0,time:0,dur:1,count:0}], pattern(0))
  assert([{value:'x',idx:0,time:0,dur:1,count:1}], pattern(1))

  pattern = parsePattern('xo', {})
  assert([{value:'x',idx:0,time:0,dur:1,count:0}], pattern(0))
  assert([{value:'o',idx:1,time:0,dur:1,count:1}], pattern(1))
  assert([{value:'x',idx:0,time:0,dur:1,count:2}], pattern(2))

  pattern = parsePattern('xo', {dur:1/2})
  assert([{value:'x',idx:0,time:0,dur:1/2,count:0},{value:'o',idx:1,time:1/2,dur:1/2,count:0.5}], pattern(0))
  assert([{value:'x',idx:0,time:0,dur:1/2,count:1},{value:'o',idx:1,time:1/2,dur:1/2,count:1.5}], pattern(1))

  pattern = parsePattern('-', {dur:1/4})
  assert([{value:'-',idx:0,time:0,dur:1/4,count:0},{value:'-',idx:0,time:1/4,dur:1/4,count:1/4},{value:'-',idx:0,time:2/4,dur:1/4,count:2/4},{value:'-',idx:0,time:3/4,dur:1/4,count:3/4}], pattern(0))
  assert([{value:'-',idx:0,time:0,dur:1/4,count:1},{value:'-',idx:0,time:1/4,dur:1/4,count:5/4},{value:'-',idx:0,time:2/4,dur:1/4,count:6/4},{value:'-',idx:0,time:3/4,dur:1/4,count:7/4}], pattern(1))

  pattern = parsePattern('-', {dur:4/5})
  assert([{value:'-',idx:0,time:0,dur:4/5,count:0},{value:'-',idx:0,time:4/5,dur:4/5,count:4/5}], pattern(0))
  assert([{value:'-',idx:0,time:3/5,dur:4/5,count:8/5}], pattern(1))
  assert([{value:'-',idx:0,time:2/5,dur:4/5,count:12/5}], pattern(2))
  assert([{value:'-',idx:0,time:1/5,dur:4/5,count:16/5}], pattern(3))
  assert([{value:'-',idx:0,time:0,dur:4/5,count:4},{value:'-',idx:0,time:4/5,dur:4/5,count:24/5}], pattern(4))
  assert([{value:'-',idx:0,time:3/5,dur:4/5,count:28/5}], pattern(5))

  pattern = parsePattern('xo', {dur:2})
  assert([{value:'x',idx:0,time:0,dur:2,count:0}], pattern(0))
  assert([], pattern(1))
  assert([{value:'o',idx:1,time:0,dur:2,count:2}], pattern(2))
  assert([], pattern(3))
  assert([{value:'x',idx:0,time:0,dur:2,count:4}], pattern(4))

  pattern = parsePattern('xo', {dur:3/2})
  assert([{value:'x',idx:0,time:0,dur:3/2,count:0}], pattern(0))
  assert([{value:'o',idx:1,time:1/2,dur:3/2,count:3/2}], pattern(1))
  assert([], pattern(2))
  assert([{value:'x',idx:0,time:0,dur:3/2,count:3}], pattern(3))

  pattern = parsePattern('xo', {dur:3})
  assert([{value:'x',idx:0,time:0,dur:3,count:0}], pattern(0))
  assert([], pattern(1))
  assert([], pattern(2))
  assert([{value:'o',idx:1,time:0,dur:3,count:3}], pattern(3))
  assert([], pattern(4))
  assert([], pattern(5))
  assert([{value:'x',idx:0,time:0,dur:3,count:6}], pattern(6))

  pattern = parsePattern('xo', {dur:2.5})
  assert([{value:'x',idx:0,time:0,dur:2.5,count:0}], pattern(0))
  assert([], pattern(1))
  assert([{value:'o',idx:1,time:0.5,dur:2.5,count:2.5}], pattern(2))
  assert([], pattern(3))
  assert([], pattern(4))
  assert([{value:'x',idx:0,time:0,dur:2.5,count:5}], pattern(5))

  pattern = parsePattern('=--.--', {dur:1/3})
  assert([{value:'=',idx:0,time:0,dur:1/3,count:0},{value:'-',idx:1,time:1/3,dur:1/3,count:1/3},{value:'-',idx:2,time:2/3,dur:1/3,count:2/3}], pattern(0))
  assert([{value:'-',idx:4,time:1/3,dur:1/3,count:4/3},{value:'-',idx:5,time:2/3,dur:1/3,count:5/3}], pattern(1))
  assert([{value:'=',idx:0,time:0,dur:1/3,count:6/3},{value:'-',idx:1,time:1/3,dur:1/3,count:7/3},{value:'-',idx:2,time:2/3,dur:1/3,count:8/3}], pattern(2))

  pattern = parsePattern('[xo]', {})
  assert([{value:'x',idx:0,time:0,dur:1/2,count:0},{value:'o',idx:1,time:1/2,dur:1/2,count:1/2}], pattern(0))
  assert([{value:'x',idx:0,time:0,dur:1/2,count:1},{value:'o',idx:1,time:1/2,dur:1/2,count:3/2}], pattern(1))

  pattern = parsePattern('[---]', {})
  assert([{value:'-',idx:0,time:0,dur:1/3,count:0},{value:'-',idx:1,time:1/3,dur:1/3,count:1/3},{value:'-',idx:2,time:2/3,dur:1/3,count:2/3}], pattern(0))
  assert([{value:'-',idx:0,time:0,dur:1/3,count:1},{value:'-',idx:1,time:1/3,dur:1/3,count:4/3},{value:'-',idx:2,time:2/3,dur:1/3,count:5/3}], pattern(1))

  pattern = parsePattern('[--[--]-]', {})
  assert([{value:'-',idx:0,time:0,dur:1/4,count:0},{value:'-',idx:1,time:1/4,dur:1/4,count:1/4},{value:'-',idx:2,time:1/2,dur:1/8,count:1/2},{value:'-',idx:3,time:5/8,dur:1/8,count:5/8},{value:'-',idx:4,time:3/4,dur:1/4,count:3/4}], pattern(0))
  assert([{value:'-',idx:0,time:0,dur:1/4,count:1},{value:'-',idx:1,time:1/4,dur:1/4,count:5/4},{value:'-',idx:2,time:1/2,dur:1/8,count:3/2},{value:'-',idx:3,time:5/8,dur:1/8,count:13/8},{value:'-',idx:4,time:3/4,dur:1/4,count:7/4}], pattern(1))

  pattern = parsePattern('[xo]', {dur:1/2})
  assert([{value:'x',idx:0,time:0,dur:1/4,count:0},{value:'o',idx:1,time:1/4,dur:1/4,count:1/4},{value:'x',idx:0,time:1/2,dur:1/4,count:2/4},{value:'o',idx:1,time:3/4,dur:1/4,count:3/4}], pattern(0))
  assert([{value:'x',idx:0,time:0,dur:1/4,count:1},{value:'o',idx:1,time:1/4,dur:1/4,count:5/4},{value:'x',idx:0,time:1/2,dur:1/4,count:6/4},{value:'o',idx:1,time:3/4,dur:1/4,count:7/4}], pattern(1))

  pattern = parsePattern('[xo].', {dur:1/2})
  assert([{value:'x',idx:0,time:0,dur:1/4,count:0},{value:'o',idx:1,time:1/4,dur:1/4,count:1/4}], pattern(0))
  assert([{value:'x',idx:0,time:0,dur:1/4,count:1},{value:'o',idx:1,time:1/4,dur:1/4,count:5/4}], pattern(1))

  pattern = parsePattern('012345', {dur:2})
  for (let i = 0; i < 20; i++) {
    assert([{value:''+(i%6),idx:(i%6),time:0,dur:2,count:2*i}], pattern(2*i))
    assert([], pattern(2*i+1))
  }

  pattern = parsePattern('0123', {dur:[1,2]})
  assert([{value:'0',idx:0,time:0,dur:1,count:0}], pattern(0))
  assert([{value:'1',idx:1,time:0,dur:2,count:1}], pattern(1))
  assert([], pattern(2))
  assert([{value:'2',idx:2,time:0,dur:1,count:3}], pattern(3))
  assert([{value:'3',idx:3,time:0,dur:2,count:4}], pattern(4))
  assert([], pattern(5))
  assert([{value:'0',idx:0,time:0,dur:1,count:6}], pattern(6))

  pattern = parsePattern('x', {dur:[1,1/2,1/2]})
  assert([{value:'x',idx:0,time:0,dur:1,count:0}], pattern(0))
  assert([{value:'x',idx:1,time:0,dur:1/2,count:1},{value:'x',idx:2,time:1/2,dur:1/2,count:3/2}], pattern(1))
  assert([{value:'x',idx:0,time:0,dur:1,count:2}], pattern(2))

  pattern = parsePattern('0-1-2-x1', {})
  assert([{value:'0',idx:0,time:0,dur:1,count:0}], pattern(0))
  assert([{value:'-1',idx:1,time:0,dur:1,count:1}], pattern(1))
  assert([{value:'-2',idx:2,time:0,dur:1,count:2}], pattern(2))
  assert([{value:'-',idx:3,time:0,dur:1,count:3}], pattern(3))
  assert([{value:'x',idx:4,time:0,dur:1,count:4}], pattern(4))
  assert([{value:'1',idx:5,time:0,dur:1,count:5}], pattern(5))

  pattern = parsePattern('0', {amp:2})
  assert([{value:'0',idx:0,time:0,dur:1,count:0,amp:2}], pattern(0))

  pattern = parsePattern('01', {amp:[2,3]})
  assert([{value:'0',idx:0,time:0,dur:1,count:0,amp:2}], pattern(0))
  assert([{value:'1',idx:1,time:0,dur:1,count:1,amp:3}], pattern(1))
  assert([{value:'0',idx:0,time:0,dur:1,count:2,amp:2}], pattern(2))

  pattern = parsePattern('0', {delay:1/2})
  assert([{value:'0',idx:0,delay:1/2,time:1/2,dur:1,count:1/2}], pattern(0))

  pattern = parsePattern('123', {delay:1})
  assert([{value:'1',idx:0,delay:1,time:1,dur:1,count:1}], pattern(0))
  assert([{value:'2',idx:1,delay:1,time:1,dur:1,count:2}], pattern(1))
  assert([{value:'3',idx:2,delay:1,time:1,dur:1,count:3}], pattern(2))
  assert([{value:'1',idx:0,delay:1,time:1,dur:1,count:4}], pattern(3))

  pattern = parsePattern('123', {delay:-1})
  assert([{value:'1',idx:0,delay:-1,time:-1,dur:1,count:-1}], pattern(0))
  assert([{value:'2',idx:1,delay:-1,time:-1,dur:1,count:0}], pattern(1))
  assert([{value:'3',idx:2,delay:-1,time:-1,dur:1,count:1}], pattern(2))

  pattern = parsePattern('0', {amp:()=>[2,3]})
  assert([{value:'0',idx:0,time:0,dur:1,count:0,amp:2},{value:'0',idx:0,time:0,dur:1,count:0,amp:3}], pattern(0))
  assert([{value:'0',idx:0,time:0,dur:1,count:1,amp:2},{value:'0',idx:0,time:0,dur:1,count:1,amp:3}], pattern(1))

  pattern = parsePattern('01', {amp:[()=>[1,2],()=>[3,4]]})
  assert([{value:'0',idx:0,time:0,dur:1,count:0,amp:1},{value:'0',idx:0,time:0,dur:1,count:0,amp:2}], pattern(0))
  assert([{value:'1',idx:1,time:0,dur:1,count:1,amp:3},{value:'1',idx:1,time:0,dur:1,count:1,amp:4}], pattern(1))
  assert([{value:'0',idx:0,time:0,dur:1,count:2,amp:1},{value:'0',idx:0,time:0,dur:1,count:2,amp:2}], pattern(2))

  pattern = parsePattern('0', {amp:()=>[2,3],dur:2,decay:1})
  assert([{value:'0',idx:0,time:0,dur:2,count:0,amp:2,decay:1},{value:'0',idx:0,time:0,dur:2,count:0,amp:3,decay:1}], pattern(0))
  assert([], pattern(1))
  assert([{value:'0',idx:0,time:0,dur:2,count:2,amp:2,decay:1},{value:'0',idx:0,time:0,dur:2,count:2,amp:3,decay:1}], pattern(2))

  pattern = parsePattern('0', {amp:()=>[2,3],decay:()=>[4,5]})
  assert([{value:'0',idx:0,time:0,dur:1,count:0,amp:2,decay:4},{value:'0',idx:0,time:0,dur:1,count:0,amp:2,decay:5},{value:'0',idx:0,time:0,dur:1,count:0,amp:3,decay:4},{value:'0',idx:0,time:0,dur:1,count:0,amp:3,decay:5}], pattern(0))

  pattern = parsePattern('0', {delay:()=>[0,1/2]})
  assert([{value:'0',idx:0,delay:0,time:0,dur:1,count:0},{value:'0',idx:0,delay:1/2,time:1/2,dur:1,count:1/2}], pattern(0))
  assert([{value:'0',idx:0,delay:0,time:0,dur:1,count:1},{value:'0',idx:0,delay:1/2,time:1/2,dur:1,count:3/2}], pattern(1))

  pattern = parsePattern('0', {amp:(_,x)=>x%3})
  assert([{value:'0',idx:0,time:0,dur:1,count:0,amp:0}], pattern(0))
  assert([{value:'0',idx:0,time:0,dur:1,count:1,amp:1}], pattern(1))
  assert([{value:'0',idx:0,time:0,dur:1,count:2,amp:2}], pattern(2))
  assert([{value:'0',idx:0,time:0,dur:1,count:3,amp:0}], pattern(3))

  pattern = parsePattern('0', {amp:(_,x)=>[0,1]})
  assert([{value:'0',idx:0,time:0,dur:1,count:0,amp:0},{value:'0',idx:0,time:0,dur:1,count:0,amp:1}], pattern(0))
  assert([{value:'0',idx:0,time:0,dur:1,count:1,amp:0},{value:'0',idx:0,time:0,dur:1,count:1,amp:1}], pattern(1))

  pattern = parsePattern('0_', {})
  assert([{value:'0',idx:0,time:0,dur:2,count:0}], pattern(0))
  assert([], pattern(1))
  assert([{value:'0',idx:0,time:0,dur:2,count:2}], pattern(2))

  pattern = parsePattern('0[_1]', {})
  assert([{value:'0',idx:0,time:0,dur:1.5,count:0}], pattern(0))
  assert([{value:'1',idx:1,time:1/2,dur:1/2,count:3/2}], pattern(1))
  assert([{value:'0',idx:0,time:0,dur:1.5,count:2}], pattern(2))

  pattern = parsePattern('(xo)', {})
  assert([{value:'x',idx:0,time:0,dur:1,count:0},{value:'o',idx:1,time:0,dur:1,count:0}], pattern(0))
  assert([{value:'x',idx:0,time:0,dur:1,count:1},{value:'o',idx:1,time:0,dur:1,count:1}], pattern(1))

  pattern = parsePattern('(01)_', {})
  assert([{value:'0',idx:0,time:0,dur:2,count:0},{value:'1',idx:1,time:0,dur:2,count:0}], pattern(0))
  assert([], pattern(1))

  pattern = parsePattern('[.(24)]_', {})
  assert([{value:'2',idx:1,time:0.5,dur:1.5,count:1/2},{value:'4',idx:2,time:0.5,dur:1.5,count:1/2}], pattern(0))
  assert([], pattern(1))

  pattern = parsePattern('x(o[--])', {})
  assert([{value:'x',idx:0,time:0,dur:1,count:0}], pattern(0))
  assert([{value:'o',idx:1,time:0,dur:1,count:1},{value:'-',idx:2,time:0,dur:0.5,count:1},{value:'-',idx:3,time:0.5,dur:0.5,count:3/2}], pattern(1))
  assert([{value:'x',idx:0,time:0,dur:1,count:2}], pattern(2))

  pattern = parsePattern('x([--]o)', {})
  assert([{value:'x',idx:0,time:0,dur:1,count:0}], pattern(0))
  assert([{value:'-',idx:1,time:0,dur:0.5,count:1},{value:'o',idx:2,time:0,dur:1,count:1},{value:'-',idx:3,time:0.5,dur:0.5,count:3/2}], pattern(1))
  assert([{value:'x',idx:0,time:0,dur:1,count:2}], pattern(2))

  pattern = parsePattern('<01>', {})
  assert([{value:'0',idx:0,time:0,dur:1,count:0}], pattern(0))
  assert([{value:'1',idx:0,time:0,dur:1,count:1}], pattern(1))
  assert([{value:'0',idx:0,time:0,dur:1,count:2}], pattern(2))

  pattern = parsePattern('<01><345>', {dur:1/2})
  assert([{value:'0',idx:0,time:0,dur:1/2,count:0},{value:'3',idx:1,time:1/2,dur:1/2,count:1/2}], pattern(0))
  assert([{value:'1',idx:0,time:0,dur:1/2,count:1},{value:'4',idx:1,time:1/2,dur:1/2,count:3/2}], pattern(1))
  assert([{value:'0',idx:0,time:0,dur:1/2,count:2},{value:'5',idx:1,time:1/2,dur:1/2,count:5/2}], pattern(2))
  assert([{value:'1',idx:0,time:0,dur:1/2,count:3},{value:'3',idx:1,time:1/2,dur:1/2,count:7/2}], pattern(3))

  pattern = parsePattern('<1[23]>', {})
  assert([{value:'1',idx:0,time:0,dur:1,count:0}], pattern(0))
  assert([{value:'2',idx:0,time:0,dur:1/2,count:1},{value:'3',idx:0,time:1/2,dur:1/2,count:3/2}], pattern(1))
  assert([{value:'1',idx:0,time:0,dur:1,count:2}], pattern(2))

  let evalPerFrame = ()=>1
  evalPerFrame.interval = 'frame'
  assert(1, parsePattern('0', {scroll:evalPerFrame})(0)[0].scroll())

  let perFrameTuple = ()=>[1,2]
  perFrameTuple.interval = 'frame'
  pattern = parsePattern('0', {lpf:perFrameTuple})
  assert([{value:'0',idx:0,time:0,dur:1,count:0,lpf:1},{value:'0',idx:0,time:0,dur:1,count:0,lpf:2}], pattern(0))

  let tupleWrappingPerFrame = ()=>[10,evalPerFrame]
  pattern = parsePattern('0', {lpf:tupleWrappingPerFrame})
  assert({value:'0',idx:0,time:0,dur:1,count:0,lpf:10}, pattern(0)[0])
  assert('function', typeof pattern(0)[1].lpf)

  pattern = parsePattern('0', {dur:[1,2]})
  assert([{value:'0',idx:0,time:0,dur:1,count:0}], pattern(0))
  assert([{value:'0',idx:1,time:0,dur:2,count:1}], pattern(1))
  assert([], pattern(2))
  assert([{value:'0',idx:0,time:0,dur:1,count:3}], pattern(3))

  pattern = parsePattern('(01)', {dur:1})
  assert([{value:'0',idx:0,time:0,dur:1,count:0},{value:'1',idx:1,time:0,dur:1,count:0}], pattern(0))
  assert([{value:'0',idx:0,time:0,dur:1,count:1},{value:'1',idx:1,time:0,dur:1,count:1}], pattern(1))
  assert([{value:'0',idx:0,time:0,dur:1,count:2},{value:'1',idx:1,time:0,dur:1,count:2}], pattern(2))
  assert([{value:'0',idx:0,time:0,dur:1,count:3},{value:'1',idx:1,time:0,dur:1,count:3}], pattern(3))

  pattern = parsePattern('(01)', {dur:[1,2]})
  assert([{value:'0',idx:0,time:0,dur:1,count:0},{value:'1',idx:1,time:0,dur:1,count:0}], pattern(0))
  assert([{value:'0',idx:2,time:0,dur:2,count:1},{value:'1',idx:3,time:0,dur:2,count:1}], pattern(1))
  assert([], pattern(2))
  assert([{value:'0',idx:0,time:0,dur:1,count:3},{value:'1',idx:1,time:0,dur:1,count:3}], pattern(3))

  pattern = parsePattern('1(23)4', {dur:[1,1/2,1]})
  assert([{value:'1',idx:0,time:0,dur:1,count:0}], pattern(0))
  assert([{value:'2',idx:1,time:0,dur:0.5,count:1},{value:'3',idx:2,time:0,dur:0.5,count:1},{value:'4',idx:3,time:0.5,dur:1,count:1.5}], pattern(1))
  assert([{value:'1',idx:0,time:0.5,dur:1,count:2.5}], pattern(2))

  pattern = parsePattern('0#', {dur:1})
  assert([{value:'0',idx:0,time:0,dur:1,count:0,sharp:1}], pattern(0))

  pattern = parsePattern('0b', {dur:1})
  assert([{value:'0',idx:0,time:0,dur:1,count:0,sharp:-1}], pattern(0))

  console.log("Pattern tests complete")
  }
  
  return parsePattern
});
