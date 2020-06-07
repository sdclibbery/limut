define(function(require) {

  let parsePattern = (pattern, params) => {
    let steps = pattern.split('')
    let dur = params.dur || 1
    let stepsPerBeat = 1/dur
    events = []
    steps.forEach((step, idx) => {
      let sound = steps[idx]
      let time = 0
      event = Object.assign({sound:sound, time:time}, params)
      events.push([event])
    })
    return events
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

  //assert([[{sound:'x',time:0},{sound:'o',time:1/2}]], parsePattern('xo', {dur:1/2}))

  //assert([[{sound:'x',time:0},{sound:'o',time:1/2}]], parsePattern('[xo]', {}))

  //assert([[{sound:'x',time:0}],[{sound:'.',time:0}],[{sound:'o',time:0}],[{sound:'.',time:0}]], parsePattern('(xo).', {}))

  //etc

  return parsePattern
});
