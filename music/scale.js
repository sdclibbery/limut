'use strict';
define(function (require) {
  let {evalMainParamEvent,evalSubParamEvent} = require('play/eval-audio-params')
  let addVarFunction = require('predefined-vars').addVarFunction

  let scales = {
    chromatic       :[0,1,2,3,4,5,6,7,8,9,10,11],

    major           :[0,2,4,5,7,9,11],
    majorpentatonic :[0,2,4,7,9],
    pentatonic      :[0,2,4,7,9],
    penta           :[0,2,4,7,9],

    minor           :[0,2,3,5,7,8,10],
    aeolian         :[0,2,3,5,7,8,10],
    minorpentatonic :[0,3,5,7,10],
    minorpenta      :[0,3,5,7,10],

    mixolydian      :[0,2,4,5,7,9,10],

    melodicminor    :[0,2,3,5,7,9,11],
    melodicmajor    :[0,2,4,5,7,8,11],

    harmonicminor   :[0,2,3,5,7,8,11],
    harmonicmajor   :[0,2,4,5,7,8,11],

    dorian          :[0,2,3,5,7,9,10],
    dorian2         :[0,1,3,5,6,8,9,11],
    diminished      :[0,1,3,4,6,7,9,10],

    egyptian        :[0,2,5,7,10],
    yu              :[0,3,5,7,10],
    zhi             :[0,2,5,7,9],
    phrygian        :[0,1,3,5,7,8,10],
    prometheus      :[0,2,4,6,11],
    indian          :[0,4,5,7,10],

    locrian         :[0,1,3,5,6,8,10],
    locrianmajor    :[0,2,4,5,6,8,10],

    lydian          :[0,2,4,6,7,9,11],
    lydianminor     :[0,2,4,6,7,8,10],

    hungarianminor  :[ 0, 2, 3, 6, 7, 8, 11 ],
    romanianminor   :[ 0, 2, 3, 6, 7, 9, 10 ],
    chinese         :[ 0, 4, 6, 7, 11 ],

    wholetone       :[ 0, 2, 4, 6, 8, 10 ],

    // Half-Whole Diminished Scale - halfWhole
    halfwhole       :[ 0, 1, 3, 4, 6, 7, 9, 10 ],
    // Whole-Half Diminished Scale - wholeHalf
    wholehalf       :[ 0, 2, 3, 5, 6, 8, 9, 11 ],

    // Bebop Scales ###
    bebopmaj        :[ 0, 2, 4, 5, 7, 8, 9, 11 ],
    bebopdorian     :[ 0, 2, 3, 4, 5, 9, 10 ],
    bebopdom        :[ 0, 2, 4, 5, 7, 9, 10, 11 ],
    bebopmelmin     :[ 0, 2, 3, 5, 7, 8, 9, 11 ],
    blues           :[ 0, 3, 5, 6, 7, 10 ],

    // Modes of the Melodic Minor Scale ###
    // First mode - Min/Maj chord
    minmaj         :[ 0, 2, 3, 5, 7, 9, 11 ],
    // Second mode - (x)susb9
    susb9          :[ 0, 1, 3, 5, 7, 9, 10 ],
    // Third Mode - Lydian Augmented, (x)Maj7#5
    lydianaug      :[ 0, 2, 4, 6, 8, 9, 11 ],
    // Fourth Mode - Lydian Dominant, (x)7#11
    lydiandom      :[ 0, 2, 4, 6, 7, 9, 10 ],
    // Fifth Mode - seldom used, but it's IMinMaj/V
    melmin5th      :[ 0, 2, 4, 5, 7, 8, 10 ],
    // Sixth Mode - half-diminished (aka Locrian #2), (x)half-diminished
    halfdim      :[ 0, 2, 3, 5, 6, 8, 10 ],
    // Seventh Mode - altered (diminished whole-tone), (x)7alt
    altered      :[ 0, 1, 3, 4, 6, 8, 10 ],
  }
  let scale = {
    scales: scales,
    current: 'major',
    root: 0,
  }

  scale.set = (s) => {
    if (scales[s]) {
      scale.current = s
    } else {
      throw 'Invalid scale '+s
    }
    return scale.current
  }

  scale.setRoot = (r) => {
    scale.root = r
    return scale.root
  }

  scale.degreeToFreq = (degree, octave, scaleOverride, sharp) => {
    if (typeof degree !== 'number') { degree = 0 }
    degree = Math.floor(degree) // Has to be floor not round; round gives an uneven distribution for randoms
    octave = Math.floor(octave)
    let currentScale = scales[scaleOverride || scale.current]
    let octDelta = Math.floor(degree / currentScale.length)
    let oct = octave - 4 + octDelta
    let chromatic = currentScale[(degree + currentScale.length*100) % currentScale.length] + oct*12 + scale.root + sharp
    return 261.6256 * Math.pow(2, chromatic/12)
  }

  scale.paramsToFreq = (params, defaultOctave) => {
    let degree = (parseInt(params.sound) || 0) + evalMainParamEvent(params, 'add', 0)
    if (isNaN(parseInt(degree))) { return }
    let octave = evalMainParamEvent(params, 'oct', defaultOctave)
    let sharp = evalMainParamEvent(params, 'sharp', 0) + evalSubParamEvent(params, 'add', '#', 0) - evalSubParamEvent(params, 'add', 'b', 0)
    let freq = scale.degreeToFreq(degree, octave, evalMainParamEvent(params, 'scale'), sharp)
    params.freq = freq
    return freq
  }

  let pitchFunc = (args, e,b) => {
    args = args || {}
    let value = args.value || 0
    let degree = evalMainParamEvent(args, 'value', 0)
    let octave = evalMainParamEvent(args, 'oct', 4)
    let sharp = evalMainParamEvent(args, 'sharp', 0) + evalMainParamEvent(value, '#', 0) - evalMainParamEvent(value, 'b', 0)
    return scale.degreeToFreq(degree, octave, args.scale, sharp)
  }
  addVarFunction('pitch', pitchFunc)

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
  let assert = (expected, actual) => {
    let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(1) : v)
    let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(1) : v)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  assert(261.6, scale.degreeToFreq(0, 4, 'major', 0))
  assert(261.6, scale.degreeToFreq(0.4, 4.4, 'major', 0))
  assert(261.6, scale.degreeToFreq(0.6, 4.6, 'major', 0))
  assert(130.8, scale.degreeToFreq(0, 3, 'major', 0))
  assert(523.3, scale.degreeToFreq(0, 5, 'major', 0))
  assert(440.0, scale.degreeToFreq(5, 4, 'major', 0))
  assert(246.9, scale.degreeToFreq(-1, 4, 'major', 0))
  assert(246.9, scale.degreeToFreq(0, 4, 'major', -1))

  assert(261.6, scale.degreeToFreq(0, 4, 'chromatic', 0))
  assert(415.3, scale.degreeToFreq(8, 4, 'chromatic', 0))

  assert(261.6, scale.degreeToFreq('x', 4, 'major', 0))
  assert(261.6, scale.degreeToFreq('-', 4, 'major', 0))

  assert(261.6, pitchFunc({value:'x'}))
  assert(261.6, pitchFunc({value:0}))
  assert(261.6/2, pitchFunc({sharp:-12}))
  assert(261.6/2, pitchFunc({value:{value:0,"#":-12}}))
  assert(261.6/2, pitchFunc({value:{value:0,"b":12}}))
  assert(261.6/4, pitchFunc({value:{value:0,"b":12},sharp:-12}))

  console.log('Scale tests complete')
  }

  return scale
});
