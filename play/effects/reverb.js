'use strict';
define(function (require) {
  let system = require('play/system')
  let {mix} = require('play/effects/mix')
  let {mainParam} = require('player/sub-param')
  let {evalMainParamEvent,evalSubParamEvent} = require('play/eval-audio-params')
  var metronome = require('metronome')

  function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
  }

  let convolutionReverb = (duration, curve) => {
    let reverb = system.audio.createConvolver()
    var rate = system.audio.sampleRate
    var length = rate * duration
    var impulse = system.audio.createBuffer(2, length, rate)
    var impulseL = impulse.getChannelData(0)
    var impulseR = impulse.getChannelData(1)
    let random = mulberry32(1) // Same random seed every time, so the reverb tail is consistent every time
    for (var i = 0; i < length; i++) {
      impulseL[i] = (random() * 2 - 1) * Math.pow(1 - i / length, curve)
      impulseR[i] = (random() * 2 - 1) * Math.pow(1 - i / length, curve)
    }
    reverb.buffer = impulse
    return reverb
  }

  let reverb = (params, node) => {
    if (!mainParam(params.reverb, 0)) { return node }
    let duration = evalMainParamEvent(params, 'reverb', 1/2) * metronome.beatDuration()
    let curve = evalSubParamEvent(params, 'reverb', 'curve', 3)
    let rev = convolutionReverb(duration, curve)
    let boost = system.audio.createGain()
    boost.gain.value = 6 // Boost the wet signal else the whole bus sounds quieter with a reverb in
    node.connect(rev)
    rev.connect(boost)
    params._destroyWait += duration
    params._destructor.disconnect(rev, boost)
    return mix(params, 'reverb', node, boost, 1/3)
  }

  let fixedReverb = (destructor, duration, curve, hpf, node) => {
    if (!duration || duration < 0.0001) { return node }
    let rev = convolutionReverb(duration, curve)
    let boost = system.audio.createGain()
    boost.gain.value = 6 // Boost the wet signal else the whole bus sounds quieter with a reverb in
    if (!!hpf) {
      let filter = system.audio.createBiquadFilter()
      filter.type = 'highpass'
      filter.frequency.value = hpf
      filter.Q.value = 5
      node.connect(filter)
      filter.connect(rev)
    } else {
      node.connect(rev)
    }
    rev.connect(boost)
    destructor.disconnect(rev, boost)
    return boost
  }

  return {
    reverb: reverb,
    fixedReverb: fixedReverb,
  }
})
