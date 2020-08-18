'use strict';
define(function (require) {
  let system = require('play/system');
  let effects = require('play/effects')
  let param = require('player/default-param')

  let symbols = {
    "&": "ampersand",
    "@": "at",
    "|": "bar",
    ":": "colon",
    "=": "equals",
    "/": "forwardslash",
    "-": "hyphen",
    "%": "percent",
    "?": "question",
    "~": "tilde",
    "*": "asterix",
    "\\": "backslash",
    "^": "caret",
    "$": "dollar",
    "!": "exclamation",
    "#": "hash",
    "<": "lessthan",
    "+": "plus",
    ";": "semicolon",
    "1": "1",
    "2": "2",
    "3": "3",
    "4": "4",
  }

  let getUrl = (char, sample) => {
    if (char == '.' || char == ' ') {
      return null
    } else if (symbols[char]) {
      return "sample/symbol/"+symbols[char]+"/0"+sample+".wav"
    } else {
      let subdir = char.toUpperCase()==char ? "upper" : "lower"
      return "sample/"+char.toLowerCase()+"/"+subdir+"/0"+sample+".wav"
    }
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

  return (params) => {
    let rate = param(params.rate, 1)
    let source = system.audio.createBufferSource()
    source.buffer = getBuffer(getUrl(params.sound, param(params.sample, 1)))
    source.playbackRate.value = rate
    params.endTime = params.time + param(params.dur, 0.1)*params.beat.duration

    let vca = system.audio.createGain()
    vca.gain.value = Math.max(0, 0.2 * param(params.amp, 1))
    source.connect(vca)
    system.mix(effects(params, vca))

    source.start(params.time)
  }
});
