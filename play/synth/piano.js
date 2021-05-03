'use strict';
define(function (require) {
  let system = require('play/system');
  let {getBuffer, isLoaded} = require('play/samples')
  let effects = require('play/effects')
  let waveEffects = require('play/wave-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')
  let scale = require('music/scale');

  let getNoteUrl = (note) => {
    return 'sample/salamander/'+note+'v8.mp3'
  }
  let getHarmonicsUrl = (note) => {
    return 'sample/salamander/harmS'+note+'.mp3'
  }

  let playBuffer = (params, url, rate, vca, timeOverride) => {
    let source = system.audio.createBufferSource()
    source.buffer = getBuffer(url)
    source.playbackRate.value = rate
    waveEffects(params, source).connect(vca)
    if (timeOverride !== undefined) {
      source.start(timeOverride)
      source.stop(timeOverride+1)
      system.disconnectAt(timeOverride+1, [source])
    } else {
      source.start(params.time)
      source.stop(params.endTime)
      system.disconnect(params, [source])
    }
  }

  let findNearestSample = (freq, loadedOnly) => {
    let sample
    let diff = Infinity
    Object.keys(samples).forEach(s => {
      if (loadedOnly && !isLoaded(getNoteUrl(s))) { return }
      let newDiff = Math.abs(freq - samples[s])
      if (newDiff < diff) {
        sample = s
        diff = newDiff
      }
    })
    return sample
  }
  let findNearestLoadedSample = (sample) => {
    let loadedSample = findNearestSample(samples[sample], true)
    return loadedSample || sample
  }

  let samples = {
    C1: 261.6256/8,
    C2: 261.6256/4,
    Fs2: 92.49861,
    C3: 261.6256/2,
    C4: 261.6256,
    Fs4: 369.9944,
    C5: 261.6256*2,
    C6: 261.6256*4,
  }
  return (params) => {
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 4), evalPerEvent(params, 'scale'), evalPerEvent(params, 'sharp', 0))
    let dur = Math.max(0.01, evalPerEvent(params, 'sus', evalPerEvent(params, 'dur', 0.25)))
    params.endTime = params.time + dur*params.beat.duration

    let vca = system.audio.createGain()
    let gain = Math.max(0, 0.25 * (typeof params.amp === 'number' ? params.amp : 1))
    vca.gain.cancelScheduledValues(params.time)
    vca.gain.setValueAtTime(gain, params.time)
    vca.gain.linearRampToValueAtTime(gain, params.endTime-0.01)
    vca.gain.linearRampToValueAtTime(0, params.endTime)
    vca.gain.linearRampToValueAtTime(gain, params.endTime+0.01)
    system.mix(effects(params, vca))

    let sample = findNearestSample(freq)
    getBuffer(getNoteUrl(sample))
    sample = findNearestLoadedSample(sample)
    let rate = freq/samples[sample]
    playBuffer(params, getNoteUrl(sample), rate, vca)
    getBuffer(getHarmonicsUrl(sample))
    playBuffer(params, getHarmonicsUrl(sample), rate, vca, params.endTime)
    system.disconnect(params, [vca])
  }
});
