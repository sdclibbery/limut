define(function(require) {

  let parsePattern = (pattern, params) => {
    let steps = pattern.split('')
    let dur = eval(params.dur) || 1
    events = [[]]
    let time = 0
    steps.forEach((step, idx) => {
      let sound = steps[idx]
      event = Object.assign({sound:sound, time:time}, params)
      events[events.length-1].push(event)
      time += dur
      if (time >= 1) {
        time -= 1
        events.push([])
      }
    })
    return events.filter(x => x.length>0)
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { throw(`Assertion failed.\n  Expected: ${x}\n  Actual: ${a}`) }
  }

  assert([], parsePattern('', {}))

  assert([[{sound:'x',time:0}]], parsePattern('x', {}))

  assert([[{sound:'x',time:0}],[{sound:'o',time:0}]], parsePattern('xo', {}))

  assert([[{sound:'x',time:0,dur:1/2},{sound:'o',time:1/2,dur:1/2}]], parsePattern('xo', {dur:1/2}))

  //assert([[{sound:'x',time:0},{sound:'o',time:1/2}]], parsePattern('[xo]', {}))

  //assert([[{sound:'x',time:0}],[{sound:'.',time:0}],[{sound:'o',time:0}],[{sound:'.',time:0}]], parsePattern('(xo).', {}))

  //etc

  console.log("Pattern tests complete")

  return parsePattern
});
