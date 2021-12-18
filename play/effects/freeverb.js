'use strict';
define(function (require) {
  let system = require('play/system');

  // adapted from: https://raw.githubusercontent.com/mmckegg/freeverb/master/index.js
  // adapted from: https://github.com/TONEnoTONE/Tone.js/blob/master/Tone/effect/Freeverb.js

  const sampleRate = system.audio.sampleRate
  var combFilterTunings = [1557 / sampleRate, 1617 / sampleRate, 1491 / sampleRate, 1422 / sampleRate, 1277 / sampleRate, 1356 / sampleRate, 1188 / sampleRate, 1116 / sampleRate]
  var allpassFilterFrequencies = [225, 556, 441, 341]

  let lowpassCombFilter = (dampening, delayTime, resonance, nodes) => {
    var node = system.audio.createDelay(delayTime)
    nodes.push(node)
    node.delayTime.value = delayTime

    var output = system.audio.createBiquadFilter()
    nodes.push(output)
    // this magic number seems to fix everything in Chrome 53
    // see https://github.com/livejs/freeverb/issues/1#issuecomment-249080213
    output.Q.value = -3.0102999566398125

    output.type = 'lowpass'
    output.frequency.value = dampening

    var feedback = system.audio.createGain()
    nodes.push(feedback)
    feedback.gain.value = resonance

    node.connect(output)
    output.connect(feedback)
    feedback.connect(node)

    return node
  }

  return (room, node, nodes) => {
    let dampening = 3000
    let resonance = 0.7 + 0.28 * Math.max(Math.min(room, 1), 0)

    var merger = system.audio.createChannelMerger(2)
    var splitter = system.audio.createChannelSplitter(2)
    var highpass = system.audio.createBiquadFilter()
    nodes.push(merger, splitter, highpass)
    highpass.type = 'highpass'
    highpass.frequency.value = 200
    highpass.channelCountMode = 'explicit'
    highpass.channelCount = 2

    var preamp = system.audio.createGain()
    preamp.channelCountMode = 'explicit'
    preamp.channelCount = 2
    nodes.push(preamp)
    preamp.gain.value = 0.3

    node.connect(preamp)
    preamp.connect(splitter)
    merger.connect(highpass)

    var combFilters = []
    var allpassFiltersL = []
    var allpassFiltersR = []

    for (var l = 0; l < allpassFilterFrequencies.length; l++) {
      var allpassL = system.audio.createBiquadFilter()
      nodes.push(allpassL)
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
      nodes.push(allpassR)
      allpassR.type = 'allpass'
      allpassR.frequency.value = allpassFilterFrequencies[r]
      allpassFiltersR.push(allpassR)

      if (allpassFiltersR[r - 1]) {
        allpassFiltersR[r - 1].connect(allpassR)
      }
    }
    allpassFiltersR[allpassFiltersR.length - 1].connect(merger, 0, 1)

    for (var c = 0; c < combFilterTunings.length; c++) {
      var lfpf = lowpassCombFilter(dampening, combFilterTunings[c], resonance, nodes)
      if (c < combFilterTunings.length / 2) {
        splitter.connect(lfpf, 0)
        lfpf.connect(allpassFiltersL[0])
      } else {
        splitter.connect(lfpf, 1)
        lfpf.connect(allpassFiltersR[0])
      }
      combFilters.push(lfpf)
    }

    return highpass
  }
})
