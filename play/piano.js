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

  return (params) => {
    let degree = parseInt(params.sound) + param(params.add, 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, param(params.oct, 4))
    params.endTime = params.time + param(params.dur, 0.25)*params.beat.duration

    let vca = system.audio.createGain()
    vca.gain.value = Math.max(0, 0.2 * param(params.amp, 1))
    system.mix(effects(params, vca))

    let rate = freq/130.81
    playBuffer(params, getNoteUrl('C3'), rate, vca)
    getBuffer(getHarmonicsUrl('C3'))
    playBuffer(params, getHarmonicsUrl('C3'), rate, vca, params.endTime)
  }
});
