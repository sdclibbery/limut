define(function (require) {
  let system = require('play/system');
  let effects = require('play/effects')
  let param = require('player/default-param')

  let mapping = {
    'X': 'sample/kick.wav',
    'x': 'sample/kick_low.wav',
    'O': 'sample/snare.wav',
    'o': 'sample/snare_low.wav',
    '-': 'sample/hihat_closed.wav',
    '=': 'sample/hihat_open.wav',
    '*': 'sample/clap.wav',
  }

  let buffers = {}
  let nullLoadingBuffer = system.audio.createBuffer(2, 100, 22050);

  let getBuffer = (url) => {
    let buffer = buffers[url]
    if (buffer == nullLoadingBuffer) { return null }
    if (!buffer) {
      buffers[url] = nullLoadingBuffer
      let request = new XMLHttpRequest()
      request.open('GET', url, true)
      request.responseType = 'arraybuffer'
      request.onload = function() {
        system.audio.decodeAudioData(request.response, (buf) => {
          buffers[url] = buf
        }, console.error)
      }
      request.send()
      return null
    }
    return buffer
  }

  return (params) => {
    let source = system.audio.createBufferSource()
    source.buffer = mapping[params.sound] ? getBuffer(mapping[params.sound]) : nullLoadingBuffer
    source.playbackRate = params.rate || 1
    params.endTime = params.time + param(params.dur, 0.25)*params.beat.duration

    let vca = system.audio.createGain()
    vca.gain.value = Math.max(0, 1.0 * param(params.amp, 1))
    source.connect(vca)
    system.mix(effects(params, vca))

    source.start(params.time)
  }
});
