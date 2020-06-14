define(function (require) {
  let scale = {}

  scale.degreeToFreq = (degree, octave) => {
    let degreeToChromatic = [0,2,4,5,7,9,11]
    let octDelta = Math.floor(degree / degreeToChromatic.length)
    let oct = octave - 4 + octDelta
    let chromatic = degreeToChromatic[degree % degreeToChromatic.length] + oct*12
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
  assert(440, scale.degreeToFreq(5, 4))
  console.log('Scale tests complete')

  return scale
});
