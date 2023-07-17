'use strict';
define(function(require) {

  let parseLiteral = (state) => {
    let steps = []
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === '' || char === ' ' || char === '\t') { break } // End of literal
      if (char === ']' || char === ')' || char === '>' || char ==='}') { // End of subpattern
        state.idx++ // Skip closing bracket
        break
      }
      if (char === '[') { // Parse sub pattern literal
        state.idx++ // Skip opening bracket
        steps.push(parseLiteral(state))
        continue
      }
      steps.push([{
        value: char,
        dur: 1,
      }]) // Literal event value char
      state.idx++
    }
    steps.forEach(s => {  // Scale sub patterns after parsing
                          // Note this leaves the top level pattern unscaled, so each step has dur=1 on the top level pattern,
                          // and everything inside it is appropriately scaled
      if (s.scaleDurs) { s.scaleDurs() } // Ignore actual steps, they are scaled inside scaleDurs()
    })
    let idx = 0
    return {

      next: () => { // Get the next step of event(s)
        let step = steps[idx]
        if (step && step.next) { // Sub pattern
          let subStep = step.next()
          if (subStep) { return subStep}
          idx++ // Sub pattern has finished
          step = steps[idx]
        }
        idx++
        return step
      },

      scaleDurs: () => {  // Scale the durations within this pattern based on its length
                          // Used to scale subpatterns to fit in one step duration of the parent pattern
        let scale = 1 / steps.length // Split duration up into all the steps in this pattern
        steps.forEach(s => {
          if (s.scaleDurs) {
            s.scaleDurs() // Apply duration scale to sub pattern
          } else {
            s.forEach(e => e.dur *= scale) // Apply duration scale to the events in this step
          }
        })
      },

      reset: () => { // Reset this pattern back to its beginning
        idx = 0
        steps.forEach(s => { if (s.reset) s.reset() }) // Reset sub patterns
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

    let st = (str) => { return { str:str, idx:0 } }
    let p

    p = parseLiteral(st('x'))
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())
    p.reset()
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())
  
    p = parseLiteral(st('xo'))
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'o',dur:1}], p.next())
    assert(undefined, p.next())
  
    p = parseLiteral(st('x[oh]x'))
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'o',dur:1/2}], p.next())
    assert([{value:'h',dur:1/2}], p.next())
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())
  
    p = parseLiteral(st('x[oh]x'))
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'o',dur:1/2}], p.next())
    p.reset()
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'o',dur:1/2}], p.next())
    assert([{value:'h',dur:1/2}], p.next())
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())
  
    p = parseLiteral(st('[0[12]]'))
    assert([{value:'0',dur:1/2}], p.next())
    assert([{value:'1',dur:1/4}], p.next())
    assert([{value:'2',dur:1/4}], p.next())
    assert(undefined, p.next())
  
    console.log("Literal unit tests complete")
  }
  
  return parseLiteral
});
