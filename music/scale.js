define(function (require) {
  let scale = {}

  let scales = {
    minor: [0,2,3,5,7,8,10],
    major: [0,2,4,5,7,9,11],
  }
  let currentScale = scales.minor

  scale.degreeToFreq = (degree, octave) => {
    let octDelta = Math.floor(degree / currentScale.length)
    let oct = octave - 4 + octDelta
    let chromatic = currentScale[(degree + currentScale.length*100) % currentScale.length] + oct*12
    return 261.6256 * Math.pow(2, chromatic/12)
  }

  // TESTS //

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(1) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(1) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  assert(261.6, scale.degreeToFreq(0, 4))
  assert(130.8, scale.degreeToFreq(0, 3))
  assert(523.3, scale.degreeToFreq(0, 5))
  assert(415.3, scale.degreeToFreq(5, 4))
  assert(233.1, scale.degreeToFreq(-1, 4))
  console.log('Scale tests complete')

  return scale
});
