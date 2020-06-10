define(function(require) {

  let parsePattern = (pattern, params) => {
    let steps = pattern.split('')
    let dur = eval(params.dur) || 1
    let events = [[]]
    let time = 0
    steps.forEach((step, idx) => {
      let value = steps[idx]
      event = Object.assign({value:value, time:time}, params)
      event.dur = dur
      events[events.length-1].push(event)
      time += dur
      if (time >= 0.9999) {
        time -= 1
        events.push([])
      }
    })
    events = events.filter(x => x.length>0)
    return (count) => {
      if (events.length == 0) { return [] }
      let stepIdx = count % events.length
      let eventsForStepIdx = 0
      let eventsForBeat = []
      let time = 0
      while (time < 0.9999) {
        let event = events[stepIdx][eventsForStepIdx]
        eventsForBeat.push(Object.assign({}, event, {time:time}))
        time += event.dur
        eventsForStepIdx += 1
        if (eventsForStepIdx >= events[stepIdx].length) {
          eventsForStepIdx = 0
          stepIdx += 1
          if (stepIdx >= events.length) {
            stepIdx = 0
            eventsForStepIdx = 0
          }
        }
      }
      return eventsForBeat
    }
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
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

  //assert([[{value:'x',time:0,dur:1/2},{value:'o',time:1/2,dur:1/2}]], parsePattern('xo', {dur:'1/2'}))

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
