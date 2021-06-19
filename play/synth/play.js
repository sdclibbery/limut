'use strict';
define(function (require) {
  let system = require('play/system');
  let {getBuffer} = require('play/samples')
  let effects = require('play/effects')
  let waveEffects = require('play/wave-effects')
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
    }
    sample = Math.floor(sample)
    if (char == '.' || char == ' ') {
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
    let eventDur = Math.max(evalPerEvent(params, 'sus', evalPerEvent(params, 'dur', 0)), 0)
    let bufferDur =  (source.buffer ? source.buffer.duration : 0.1)
    params.endTime = params._time + Math.min(eventDur, bufferDur)

    let vca = system.audio.createGain()
    let gainbase = 0.18 * evalPerEvent(params, "loud", 1)
    vca.gain.value = Math.max(0, gainbase * (typeof params.amp === 'number' ? params.amp : 1))
    waveEffects(params, source).connect(vca)
    system.mix(effects(params, vca))
    source.start(params._time)
    source.stop(params.endTime)
    system.disconnect(params, [source, vca])
  }
});
