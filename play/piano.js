'use strict';
define(function (require) {
  let system = require('play/system');
  let effects = require('play/effects')
  let param = require('player/default-param')
  let scale = require('music/scale');

  let getNoteUrl = (note) => {
    return 'sample/salamander/'+note+'v8.mp3'
  }
  let getHarmonicsUrl = (note) => {
    return 'sample/salamander/harmS'+note+'.mp3'
  }

  let buffers = {}
  let nullBuffer = system.audio.createBuffer(2, 100, 22050);

  let getBuffer = (url) => {
    let buffer = buffers[url]
    if (buffer == nullBuffer) { return null }
    if (!buffer) {
      buffers[url] = nullBuffer
      let request = new XMLHttpRequest()
      request.open('GET', url, true)
      request.responseType = 'arraybuffer'
      request.onload = () => {
        system.audio.decodeAudioData(request.response, (buf) => {
          buffers[url] = buf
        }, console.error)
      }
      request.send()
      return null
    }
    return buffer
  }

  let playBuffer = (params, url, rate, vca, timeOverride) => {
    let source = system.audio.createBufferSource()
    source.buffer = getBuffer(url)
    source.playbackRate.value = rate
    source.connect(vca)
    if (timeOverride !== undefined) {
      source.start(timeOverride)
    } else {
      source.start(params.time)
      source.stop(params.endTime)
    }
  }

  let isLoaded = (sample) => {
    let buf = buffers[getNoteUrl(sample)]
    return !!buf && buf !== nullBuffer
  }
  let findNearestSample = (freq, loadedOnly) => {
    let sample
    let diff = Infinity
    Object.keys(samples).forEach(s => {
      if (loadedOnly && !isLoaded(s)) { return }
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
    let degree = parseInt(params.sound) + param(params.add, 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, param(params.oct, 4), params.scale)
    let dur = Math.max(0.01, param(params.sus, param(params.dur, 0.25)))
    params.endTime = params.time + dur*params.beat.duration

    let vca = system.audio.createGain()
    let gain = Math.max(0, 0.25 * param(params.amp, 1))
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
  }
});
