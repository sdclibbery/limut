'use strict';
define(function (require) {
  let system = require('play/system');

  // adapted from: https://raw.githubusercontent.com/mmckegg/freeverb/master/index.js
  // adapted from: https://github.com/TONEnoTONE/Tone.js/blob/master/Tone/effect/Freeverb.js

  var combFilterTunings = [1557 / 44100, 1617 / 44100, 1491 / 44100, 1422 / 44100, 1277 / 44100, 1356 / 44100, 1188 / 44100, 1116 / 44100]
  var allpassFilterFrequencies = [225, 556, 441, 341]

  let lowpassCombFilter = (dampening, delayTime, resonance) => {
    var node = system.audio.createDelay(1)
    node.delayTime.value = delayTime

    var output = system.audio.createBiquadFilter()
    // this magic number seems to fix everything in Chrome 53
    // see https://github.com/livejs/freeverb/issues/1#issuecomment-249080213
    output.Q.value = -3.0102999566398125

    output.type = 'lowpass'
    output.frequency.value = dampening

    var feedback = system.audio.createGain()
    feedback.gain.value = Math.min(resonance, 0.99)

    node.connect(output)
    output.connect(feedback)
    feedback.connect(node)

    return node
  }

  return (room) => {
    let dampening = 3000

    var node = system.audio.createGain()
    node.channelCountMode = 'explicit'
    node.channelCount = 2

    var merger = system.audio.createChannelMerger(2)
    var splitter = system.audio.createChannelSplitter(2)
    var highpass = system.audio.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 200

    var wet = system.audio.createGain()
    wet.gain.value = 1

    node.connect(wet)
    wet.connect(splitter)
    merger.connect(highpass)

    var combFilters = []
    var allpassFiltersL = []
    var allpassFiltersR = []

    for (var l = 0; l < allpassFilterFrequencies.length; l++) {
      var allpassL = system.audio.createBiquadFilter()
      allpassL.type = 'allpass'
      allpassL.frequency.value = allpassFilterFrequencies[l]
      allpassFiltersL.push(allpassL)

      if (allpassFiltersL[l - 1]) {
        allpassFiltersL[l - 1].connect(allpassL)
      }
    }
    allpassFiltersL[allpassFiltersL.length - 1].connect(merger, 0, 0)

    for (var r = 0; r < allpassFilterFrequencies.length; r++) {
      var allpassR = system.audio.createBiquadFilter()
      allpassR.type = 'allpass'
      allpassR.frequency.value = allpassFilterFrequencies[r]
      allpassFiltersR.push(allpassR)

      if (allpassFiltersR[r - 1]) {
        allpassFiltersR[r - 1].connect(allpassR)
      }
    }
    allpassFiltersR[allpassFiltersR.length - 1].connect(merger, 0, 1)

    for (var c = 0; c < combFilterTunings.length; c++) {
      var lfpf = lowpassCombFilter(dampening, combFilterTunings[c], room)
      if (c < combFilterTunings.length / 2) {
        splitter.connect(lfpf, 0)
        lfpf.connect(allpassFiltersL[0])
      } else {
        splitter.connect(lfpf, 1)
        lfpf.connect(allpassFiltersR[0])
      }
      combFilters.push(lfpf)
    }

    system.mix(highpass)
    return node
  }
})
