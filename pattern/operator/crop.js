'use strict';
define(function(require) {

  let crop = (l, cropLength) => {
    let currentTime = 0
    if (!cropLength) { throw `Invalid pattern: invalid crop length ${r.src} to operator crop` }
    let pattern = {
      next: () => {
        if (currentTime >= cropLength) { return undefined } // Past the crop count, nothing more from this pattern
        let result = l.next()
        if (!result) {
          l.loop() // Loop the sub pattern if it finishes before the crop
          result = l.next()
        }
        if (!!result) {
          let maxDur = 0
          let filtered = []
          result.forEach(e => { // Crop individual event durations down if required
            let diff = currentTime + e.dur - cropLength
            if (e.dur - diff > 0) {
              if (diff > 0) {
                let cropped = Object.assign({},e)
                cropped.dur -= diff
                filtered.push(cropped)
                maxDur = Math.max(maxDur, cropped.dur)
              } else {
                filtered.push(e)
                maxDur = Math.max(maxDur, e.dur)
              }
            }
          })
          result = filtered
          currentTime += maxDur
        }
        return result
      },
      loop: () => {
        l.loop()
        currentTime = 0
      },
      reset: (numTimesLooped) => {
        l.reset(numTimesLooped)
        currentTime = 0
      },
      start: () => { // TC init is complete
        if (l.start) { l.start() }
      },
    }
    return pattern
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual, msg) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}\n${msg}`) }
    }
    let testPattern = (vs) => {
      let i = 0
      return {
        next: () => !vs[i] ? undefined : [{value:vs[i++],dur:1}],
        loop: () => { i=0 },
        reset: () => { i=0 },
      }
    }
    let p

    p = crop(testPattern(['x','y','z']), 2)
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'y',dur:1}], p.next())
    assert(undefined, p.next())
    p.loop()
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'y',dur:1}], p.next())
    assert(undefined, p.next())

    p = crop(testPattern(['x']), 2)
    assert([{value:'x',dur:1}], p.next())
    assert([{value:'x',dur:1}], p.next())
    assert(undefined, p.next())

    p = crop(testPattern(['x']), 0.5)
    assert([{value:'x',dur:1/2}], p.next())
    assert(undefined, p.next())

    console.log("Pattern crop tests complete")
  }
  
  return crop
});
