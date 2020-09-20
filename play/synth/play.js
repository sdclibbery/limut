'use strict';
define(function (require) {
  let system = require('play/system');
  let {getBuffer} = require('play/samples')
  let effects = require('play/effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

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
    if (typeof sample == 'string') {
      return sample
    } else if (char == '.' || char == ' ') {
      return null
    } else if (symbols[char]) {
      return "sample/symbol/"+symbols[char]+"/0"+sample+".wav"
    } else {
      let subdir = char.toUpperCase()==char ? "upper" : "lower"
      return "sample/"+char.toLowerCase()+"/"+subdir+"/0"+sample+".wav"
    }
  }

  return (params) => {
    let rate = evalPerEvent(params, 'rate', 1)
    let source = system.audio.createBufferSource()
    source.buffer = getBuffer(getUrl(params.sound, evalPerEvent(params, 'sample', 1)))
    source.playbackRate.value = rate
    params.endTime = params.time + (source.buffer ? source.buffer.duration : 0.1)

    let vca = system.audio.createGain()
    vca.gain.value = Math.max(0, 0.2 * evalPerEvent(params, 'amp', 1))
    source.connect(vca)
    system.mix(effects(params, vca))

    source.start(params.time)
  }
});
