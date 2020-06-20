define(function(require) {

  let debug = false

  let parsePatternString = (pattern, idx, endChar) => {
    if (!idx) { idx = {v:0} }
    let parsed = []
    let char
    while (char = pattern.charAt(idx.v)) {
      if (debug) { console.log('p/c/i ', pattern, char, idx.v) }
      if (char === endChar) {
        idx.v += 1
        return parsed
      } else if (char == '[') {
        idx.v += 1
        if (debug) { console.log('i/ps ', idx.v, pattern.slice(idx.v)) }
        let subParsed = parsePatternString(pattern, idx, ']')
        parsed.push(subParsed)
        if (debug) { console.log('sp/i/ps ', subParsed, idx.v, pattern.slice(idx.v)) }
      } else {
        parsed.push(char)
        idx.v += 1
      }
    }
    return parsed
  }

  let getEvents = (steps, stepData, durs, params) => {
    let durIdx = 0
    steps.forEach((step, idx) => {
      let dur = durs[durIdx]
      durIdx = (durIdx + 1) % durs.length
      let value = steps[idx]
      if (Array.isArray(value)) {
        getEvents(value, stepData, [dur / value.length], params)
      } else {
        event = Object.assign({value:value, time:stepData.time}, params)
        event.dur = dur
        stepData.events.push(event)
        stepData.time += dur
        stepData.patternLength += dur
      }
    })
  }

  let parsePattern = (pattern, params) => {
    if (!pattern) { return () => [] }
    let steps = parsePatternString(pattern)
    let dur = eval(params.dur) || 1
    if (!Array.isArray(dur)) { dur = [dur] }
    let stepData = {
      time: 0,
      events: [],
      patternLength: 0,
    }
    getEvents(steps, stepData, dur, params)
    let events = stepData.events
    let patternLength = stepData.patternLength
    if (debug) { console.log(pattern, dur, patternLength, events) }
    return (count) => {
      if (events.length == 0) { return [] }
      let patternStartTime = patternLength * Math.floor(count / patternLength)
      let patternBeat = count * patternLength / events.length
      let stepIdx = 0
      let eventsForBeat = []
      let time = 0
      do {
        if (debug) { console.log('idxs: ', stepIdx) }
        let event = events[stepIdx]
        time = (patternStartTime + event.time) - count
        if (debug) { console.log('pst: ', patternStartTime, 'et: ', event.time, ' t/c: ', time, count) }
        if (time > -0.0001 && time < 0.9999) {
          eventsForBeat.push(Object.assign({}, event, {time:time}))
        }
        stepIdx += 1
        if (stepIdx >= events.length) {
          stepIdx = 0
          patternStartTime += patternLength
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

  assert([], parsePatternString(''))
  assert(['x','-','o'], parsePatternString('x-o'))
  assert([['x','x']], parsePatternString('[xx]'))
  assert(['x',['-','-'],'o',['-','-']], parsePatternString('x[--]o[--]'))
  assert(['o',['x',['-','-'], 'x'],'o'], parsePatternString('o[x[--]x]o'))
  assert([[['-','-'],['-','-']]], parsePatternString('[[--][--]]'))

  // assert(['0'], parsePatternString('0'))
  // assert(['1'], parsePatternString('1'))
  // assert(['-1'], parsePatternString('-1'))
  // assert(['0','1','-1','2','-2'], parsePatternString('01-12-2'))

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

  pattern = parsePattern('[xo]', {})
  assert([{value:'x',time:0,dur:1/2},{value:'o',time:1/2,dur:1/2}], pattern(0))
  assert([{value:'x',time:0,dur:1/2},{value:'o',time:1/2,dur:1/2}], pattern(1))

  pattern = parsePattern('[---]', {})
  assert([{value:'-',time:0,dur:1/3},{value:'-',time:1/3,dur:1/3},{value:'-',time:2/3,dur:1/3}], pattern(0))
  assert([{value:'-',time:0,dur:1/3},{value:'-',time:1/3,dur:1/3},{value:'-',time:2/3,dur:1/3}], pattern(1))

  pattern = parsePattern('[--[--]-]', {})
  assert([{value:'-',time:0,dur:1/4},{value:'-',time:1/4,dur:1/4},{value:'-',time:1/2,dur:1/8},{value:'-',time:5/8,dur:1/8},{value:'-',time:3/4,dur:1/4}], pattern(0))
  assert([{value:'-',time:0,dur:1/4},{value:'-',time:1/4,dur:1/4},{value:'-',time:1/2,dur:1/8},{value:'-',time:5/8,dur:1/8},{value:'-',time:3/4,dur:1/4}], pattern(1))

  pattern = parsePattern('[xo]', {dur:1/2})
  assert([{value:'x',time:0,dur:1/4},{value:'o',time:1/4,dur:1/4},{value:'x',time:1/2,dur:1/4},{value:'o',time:3/4,dur:1/4}], pattern(0))
  assert([{value:'x',time:0,dur:1/4},{value:'o',time:1/4,dur:1/4},{value:'x',time:1/2,dur:1/4},{value:'o',time:3/4,dur:1/4}], pattern(2))

  pattern = parsePattern('[xo].', {dur:1/2})
  assert([{value:'x',time:0,dur:1/4},{value:'o',time:1/4,dur:1/4},{value:'.',time:1/2,dur:1/2}], pattern(0))
  assert([{value:'x',time:0,dur:1/4},{value:'o',time:1/4,dur:1/4},{value:'.',time:1/2,dur:1/2}], pattern(1))

  pattern = parsePattern('012345', {dur:2})
  for (let i = 0; i < 20; i++) {
    assert([{value:''+(i%6),time:0,dur:2}], pattern(2*i))
    assert([], pattern(2*i+1))
  }

  pattern = parsePattern('0123', {dur:'[1,2]'})
  assert([{value:'0',time:0,dur:1}], pattern(0))
  assert([{value:'1',time:0,dur:2}], pattern(1))
  assert([], pattern(2))
  assert([{value:'2',time:0,dur:1}], pattern(3))
  assert([{value:'3',time:0,dur:2}], pattern(4))
  assert([], pattern(5))
  assert([{value:'0',time:0,dur:1}], pattern(6))

  //pattern = parsePattern('x', {dur:'[1,2]'})
  
  console.log("Pattern tests complete")

  return parsePattern
});
