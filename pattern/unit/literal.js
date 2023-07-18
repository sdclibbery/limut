'use strict';
define(function(require) {

  let literal = (state) => {
    let steps = []
    let char
    while (char = state.str.charAt(state.idx)) {
      if (char === '' || char === ' ' || char === '\t') { break } // End of literal
      if (char === ']' || char === ')' || char === '>' || char ==='}') { // End of subpattern
        state.idx++ // Skip closing bracket after subpattern
        break
      }
      if (char === '[') { // Parse sub pattern literal
        state.idx++ // Skip opening bracket
        steps.push(literal(state))
        continue
      }
      steps.push([{
        value: char === '.' ? undefined : char,
        dur: 1,
      }]) // Literal event value char
      state.idx++
    }
    steps.forEach(s => {  // Scale sub patterns after parsing
                          // Note this leaves the top level pattern unscaled, so each step has dur=1 on the top level pattern,
                          // and everything inside it is appropriately scaled
      if (s.scaleDurs) { s.scaleDurs() } // Ignore actual steps, they are scaled inside scaleDurs()
    })
    let stepIdx = 0
    let pattern = {

      next: () => { // Get the next step of event(s)
        let step = steps[stepIdx]
        if (step && step.next) { // Sub pattern
          let subStep = step.next()
          if (subStep !== undefined) { return subStep}
          stepIdx++ // Sub pattern has finished
          return pattern.next()
        }
        stepIdx++
        return step
      },

      toStep: (stepNum) => { // Set this (and sub patterns) to a specific step number; used to initialise the pattern
        steps.forEach(s => { if (s.reset) s.reset() }) // Reset sub patterns first
        stepIdx = stepNum % steps.length
        let i = Math.floor(stepIdx) // Integer part
        let fract = stepIdx - i // Fractional part
        stepIdx = i // This pattern index is integer only
        let step = steps[stepIdx]
        if (step.toFract) {
          step.toFract(fract)
        }
      },
      toFract: (f) => {
        let step = f * steps.length // Turn fractional into actual step number
        pattern.toStep(step)
      },

      scaleDurs: () => {  // Scale the durations within this pattern based on its length
                          // Used to scale subpatterns to fit in one step duration of the parent pattern
        let scale = 1 / steps.length // Split duration up into all the steps in this pattern
        steps.forEach(s => {
          if (s.scaleDurs) {
            s.scaleDurs() // Recurse to sub pattern
          } else {
            s.forEach(e => e.dur *= scale) // Apply duration scale to the events in this step
          }
        })
      },

      reset: () => { // Reset this pattern back to its beginning
        stepIdx = 0
        steps.forEach(s => { if (s.reset) s.reset() }) // Reset sub patterns
      }

    }
    return pattern
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

    p = literal(st(''))
    assert(undefined, p.next())
    p.reset()
    assert(undefined, p.next())

    p = literal(st('[]'))
    assert(undefined, p.next())

    p = literal(st('.'))
    assert([{value:undefined,dur:1}], p.next())

    p = literal(st('x'))
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())
    p.reset()
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())
  
    p = literal(st('xo'))
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'o',dur:1}], p.next())
    assert(undefined, p.next())
  
    p = literal(st('x[oh]x'))
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'o',dur:1/2}], p.next())
    assert([{value:'h',dur:1/2}], p.next())
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())
  
    p = literal(st('[01][.2]'))
    assert([{value:'0',dur:1/2}], p.next())
    assert([{value:'1',dur:1/2}], p.next())
    assert([{value:undefined,dur:1/2}], p.next())
    assert([{value:'2',dur:1/2}], p.next())
    assert(undefined, p.next())
  
    p = literal(st('x[oh]x'))
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'o',dur:1/2}], p.next())
    p.reset()
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'o',dur:1/2}], p.next())
    assert([{value:'h',dur:1/2}], p.next())
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())
  
    p = literal(st('[0[12]]'))
    assert([{value:'0',dur:1/2}], p.next())
    assert([{value:'1',dur:1/4}], p.next())
    assert([{value:'2',dur:1/4}], p.next())
    assert(undefined, p.next())
  
    p = literal(st('0123'))
    p.toStep(0)
    assert([{value:'0',dur:1}], p.next())
    p.toStep(3)
    assert([{value:'3',dur:1}], p.next())
    p.toStep(4)
    assert([{value:'0',dur:1}], p.next())
    p.toStep(4*1e6)
    assert([{value:'0',dur:1}], p.next())
  
    p = literal(st('0[12]'))
    p.toStep(0)
    assert([{value:'0',dur:1}], p.next())
    p.toStep(0.9)
    assert([{value:'0',dur:1}], p.next())
    p.toStep(3)
    assert([{value:'1',dur:1/2}], p.next())
    p.toStep(5.5)
    assert([{value:'2',dur:1/2}], p.next())
    p.toStep(5.1)
    assert([{value:'1',dur:1/2}], p.next())
    p.toStep(5)
    assert([{value:'1',dur:1/2}], p.next())
  
    console.log("Pattern unit literal tests complete")
  }
  
  return literal
});
