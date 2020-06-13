define(function(require) {

  let debug = false
  let parsePattern = (pattern, params) => {
    let steps = pattern.split('')
    let dur = eval(params.dur) || 1
    let events = [[]]
    let time = 0
    let patternLength = 0
    steps.forEach((step, idx) => {
      let value = steps[idx]
      event = Object.assign({value:value, time:time}, params)
      event.dur = dur
      events[events.length-1].push(event)
      time += dur
      patternLength += dur
      if (time-events.length >= -0.0001) {
        events.push([])
      }
    })
    events = events.filter(x => x.length>0)
    if (debug) { console.log(pattern, dur, patternLength, events) }
    return (count) => {
      if (events.length == 0) { return [] }
      let patternStartTime = patternLength * Math.floor(count / patternLength)
      let patternBeat = count * patternLength / events.length
      let stepIdx = Math.max(0, Math.floor(patternBeat) % events.length-1)
      let eventForStepIdx = 0
      let eventsForBeat = []
      let time = 0
      do {
        if (debug) { console.log('idxs: ', stepIdx, eventForStepIdx) }
        let event = events[stepIdx][eventForStepIdx]
        time = (patternStartTime + event.time) - count
        if (debug) { console.log('pst: ', patternStartTime, 'et: ', event.time, ' t/c: ', time, count) }
        if (time > -0.0001 && time < 0.9999) {
          eventsForBeat.push(Object.assign({}, event, {time:time}))
        }
        eventForStepIdx += 1
        if (eventForStepIdx >= events[stepIdx].length) {
          eventForStepIdx = 0
          stepIdx += 1
          if (stepIdx >= events.length) {
            stepIdx = 0
            eventForStepIdx = 0
            patternStartTime += patternLength
          }
        }
      } while (time < 1.0001)
      return eventsForBeat
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
  assert([{value:'x',time:0,dur:1}], pattern(0))
  assert([{value:'x',time:0,dur:1}], pattern(1))

  pattern = parsePattern('xo', {})
  assert([{value:'x',time:0,dur:1}], pattern(0))
  assert([{value:'o',time:0,dur:1}], pattern(1))
  assert([{value:'x',time:0,dur:1}], pattern(2))

  pattern = parsePattern('xo', {dur:'1/2'})
  assert([{value:'x',time:0,dur:1/2},{value:'o',time:1/2,dur:1/2}], pattern(0))
  assert([{value:'x',time:0,dur:1/2},{value:'o',time:1/2,dur:1/2}], pattern(1))

  pattern = parsePattern('-', {dur:'1/4'})
  assert([{value:'-',time:0,dur:1/4},{value:'-',time:1/4,dur:1/4},{value:'-',time:2/4,dur:1/4},{value:'-',time:3/4,dur:1/4}], pattern(0))
  assert([{value:'-',time:0,dur:1/4},{value:'-',time:1/4,dur:1/4},{value:'-',time:2/4,dur:1/4},{value:'-',time:3/4,dur:1/4}], pattern(1))

  pattern = parsePattern('-', {dur:4/5})
  assert([{value:'-',time:0,dur:4/5},{value:'-',time:4/5,dur:4/5}], pattern(0))
  assert([{value:'-',time:3/5,dur:4/5}], pattern(1))
  assert([{value:'-',time:2/5,dur:4/5}], pattern(2))
  assert([{value:'-',time:1/5,dur:4/5}], pattern(3))
  assert([{value:'-',time:0,dur:4/5},{value:'-',time:4/5,dur:4/5}], pattern(4))
  assert([{value:'-',time:3/5,dur:4/5}], pattern(400000001))

  pattern = parsePattern('xo', {dur:2})
  assert([{value:'x',time:0,dur:2}], pattern(0))
  assert([], pattern(1))
  assert([{value:'o',time:0,dur:2}], pattern(2))
  assert([], pattern(3))
  assert([{value:'x',time:0,dur:2}], pattern(4))

  pattern = parsePattern('xo', {dur:3/2})
  assert([{value:'x',time:0,dur:3/2}], pattern(0))
  assert([{value:'o',time:1/2,dur:3/2}], pattern(1))
  assert([], pattern(2))
  assert([{value:'x',time:0,dur:3/2}], pattern(3))

  pattern = parsePattern('xo', {dur:3})
  assert([{value:'x',time:0,dur:3}], pattern(0))
  assert([], pattern(1))
  assert([], pattern(2))
  assert([{value:'o',time:0,dur:3}], pattern(3))
  assert([], pattern(4))
  assert([], pattern(5))
  assert([{value:'x',time:0,dur:3}], pattern(6))

  pattern = parsePattern('xo', {dur:2.5})
  assert([{value:'x',time:0,dur:2.5}], pattern(0))
  assert([], pattern(1))
  assert([{value:'o',time:0.5,dur:2.5}], pattern(2))
  assert([], pattern(3))
  assert([], pattern(4))
  assert([{value:'x',time:0,dur:2.5}], pattern(5))

  pattern = parsePattern('=--.--', {dur:1/3})
  assert([{value:'=',time:0,dur:1/3},{value:'-',time:1/3,dur:1/3},{value:'-',time:2/3,dur:1/3}], pattern(0))
  assert([{value:'.',time:0,dur:1/3},{value:'-',time:1/3,dur:1/3},{value:'-',time:2/3,dur:1/3}], pattern(1))
  assert([{value:'=',time:0,dur:1/3},{value:'-',time:1/3,dur:1/3},{value:'-',time:2/3,dur:1/3}], pattern(2))

  //assert([[{value:'-',time:0,dur:4/5},{value:'-',time:4/5,dur:4/5}],[{value:'-',time:8/5,dur:4/5}]], parsePattern('-', {dur:'4/5'}))

  //assert([[{value:'x',time:0},{value:'o',time:1/2}]], parsePattern('[xo]', {}))

  //assert([[{value:'x',time:0,dur:1/2},{value:'o',time:1/4,dur:1/2},{value:'x',time:1/2,dur:1/2},{value:'o',time:3/4,dur:1/2}]], parsePattern('[xo]', {dur:'1/2'}))

  //assert([[{value:'x',time:0},{value:'-',time:1/3},{value:'o',time:2/3}]], parsePattern('[x-o]', {}))

  //assert([[{value:'x',time:0},{value:'-',time:1/2},{value:'o',time:3/4}]], parsePattern('[x[-o]]', {}))

  //assert([[{value:'x',time:0}],[{value:'.',time:0}],[{value:'o',time:0}],[{value:'.',time:0}]], parsePattern('(xo).', {}))

  //etc

  console.log("Pattern tests complete")

  return parsePattern
});
