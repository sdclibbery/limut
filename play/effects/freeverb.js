'use strict';
define(function (require) {
  let system = require('play/system');
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let {mix} = require('play/effects/mix')

  // adapted from: https://raw.githubusercontent.com/mmckegg/freeverb/master/index.js
  // adapted from: https://github.com/TONEnoTONE/Tone.js/blob/master/Tone/effect/Freeverb.js

  var combFilterTunings = [1557 / 44100, 1617 / 44100, 1491 / 44100, 1422 / 44100, 1277 / 44100, 1356 / 44100, 1188 / 44100, 1116 / 44100]
  var allpassFilterFrequencies = [225, 556, 441, 341]

  let lowpassCombFilter = (dampening, delayTime, resonance, destructor) => {
    var node = system.audio.createDelay(delayTime)
    destructor.disconnect(node)
    node.delayTime.value = delayTime

    var output = system.audio.createBiquadFilter()
    destructor.disconnect(output)
    // this magic number seems to fix everything in Chrome 53
    // see https://github.com/livejs/freeverb/issues/1#issuecomment-249080213
    output.Q.value = -3.0102999566398125

    output.type = 'lowpass'
    output.frequency.value = dampening

    var feedback = system.audio.createGain()
    destructor.disconnect(feedback)
    feedback.gain.value = resonance

    node.connect(output)
    output.connect(feedback)
    feedback.connect(node)

    return node
  }

  let fixedFreeverb = (destructor, room, node) => {
    room *= 0.7
    if (!room || room < 0.01) { return node }

    let dampening = 3000
    let resonance = 0.7 + 0.28 * Math.max(Math.min(room, 1), 0)

    var merger = system.audio.createChannelMerger(2)
    var splitter = system.audio.createChannelSplitter(2)
    var highpass = system.audio.createBiquadFilter()
    destructor.disconnect(merger, splitter, highpass)
    highpass.type = 'highpass'
    highpass.frequency.value = 200
    highpass.channelCountMode = 'explicit'
    highpass.channelCount = 2

    var preamp = system.audio.createGain()
    preamp.channelCountMode = 'explicit'
    preamp.channelCount = 2
    destructor.disconnect(preamp)
    preamp.gain.value = 0.3

    node.connect(preamp)
    preamp.connect(splitter)
    merger.connect(highpass)

    var combFilters = []
    var allpassFiltersL = []
    var allpassFiltersR = []

    for (var l = 0; l < allpassFilterFrequencies.length; l++) {
      var allpassL = system.audio.createBiquadFilter()
      destructor.disconnect(allpassL)
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
      destructor.disconnect(allpassR)
      allpassR.type = 'allpass'
      allpassR.frequency.value = allpassFilterFrequencies[r]
      allpassFiltersR.push(allpassR)

      if (allpassFiltersR[r - 1]) {
        allpassFiltersR[r - 1].connect(allpassR)
      }
    }
    allpassFiltersR[allpassFiltersR.length - 1].connect(merger, 0, 1)

    for (var c = 0; c < combFilterTunings.length; c++) {
      var lfpf = lowpassCombFilter(dampening, combFilterTunings[c], resonance, destructor)
      if (c < combFilterTunings.length / 2) {
        splitter.connect(lfpf, 0)
        lfpf.connect(allpassFiltersL[0])
      } else {
        splitter.connect(lfpf, 1)
        lfpf.connect(allpassFiltersR[0])
      }
      combFilters.push(lfpf)
    }

    node.connect(highpass)
    return highpass
  }

  let mixedFreeverb = (params, node) => {
    let room = evalMainParamEvent(params, 'room', 0)
    if (!room) { return node }
    let fv = fixedFreeverb(params._destructor, room, node)
    params._destroyWait += room*5
    return mix(params, 'room', node, fv, 1/2)
  }

  return {
    fixedFreeverb: fixedFreeverb,
    mixedFreeverb: mixedFreeverb,
  }
})
