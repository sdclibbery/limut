'use strict';
define(function (require) {
  let system = require('play/system');
  let {getBuffer, isLoaded} = require('play/samples')
  let effects = require('play/effects/effects')
  let fxMixChain = require('play/effects/fxMixChain')
  let waveEffects = require('play/effects/wave-effects')
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let scale = require('music/scale');
  let perFrameAmp = require('play/effects/perFrameAmp')
  let destructor = require('play/destructor')

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
    source.start(timeOverride || params._time)
    params._destructor.disconnect(source)
    params._destructor.stop(source)
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
    let freq = scale.paramsToFreq(params, 4)
    if (isNaN(freq)) { return }
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25)))
    params.endTime = params._time + dur*params.beat.duration
    params._destructor = destructor()
    setTimeout(() => params._destructor.destroy(), 1100+(params.endTime - system.audio.currentTime)*1000)

    let vca = system.audio.createGain()
    let gain = Math.max(0, 0.25 * (typeof params.amp === 'number' ? params.amp : 1))
    vca.gain.cancelScheduledValues(params._time)
    vca.gain.setValueAtTime(gain, params._time)
    vca.gain.linearRampToValueAtTime(gain, params.endTime-0.01)
    vca.gain.linearRampToValueAtTime(0, params.endTime)
    vca.gain.linearRampToValueAtTime(gain, params.endTime+0.01)
    fxMixChain(params, effects(params, perFrameAmp(params, vca)))

    let sample = findNearestSample(freq)
    getBuffer(getNoteUrl(sample))
    sample = findNearestLoadedSample(sample)
    let rate = freq/samples[sample]
    playBuffer(params, getNoteUrl(sample), rate, vca)
    getBuffer(getHarmonicsUrl(sample))
    playBuffer(params, getHarmonicsUrl(sample), rate, vca, params.endTime)
    params._destructor.disconnect(vca)
  }
});
