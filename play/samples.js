'use strict';
define(function (require) {
  let system = require('play/system');

  let buffers = {}
  let pending = {} // url -> array of onReady callbacks waiting for the load+decode to finish
  let nullBuffer = system.audio.createBuffer(2, 100, 22050);

  // onReady (optional) is called with the AudioBuffer once load+decode finish, so a caller
  // whose buffer wasn't ready at event time can still play it as soon as it lands (instead
  // of being silent until the player is restarted). Mirrors getTtsBuffer in play/tts.js.
  let getBuffer = (url, onReady) => {
    let buffer = buffers[url]
    if (buffer && buffer !== nullBuffer) { return buffer } // ready: synchronous path
    if (onReady) { (pending[url] || (pending[url] = [])).push(onReady) }
    if (buffer === nullBuffer) { return null } // already loading; callback now queued
    buffers[url] = nullBuffer // mark as loading so we only kick off once
    let clearOnFail = () => { if (buffers[url] === nullBuffer) { delete buffers[url] }; delete pending[url] }
    let request = new XMLHttpRequest()
    request.open('GET', url, true)
    request.responseType = 'arraybuffer'
    request.onload = () => {
      system.audio.decodeAudioData(request.response, (buf) => {
        buffers[url] = buf
        let cbs = pending[url]; delete pending[url]
        if (cbs) { cbs.forEach((cb) => cb(buf)) }
      }, (e) => { console.error(e); clearOnFail() })
    }
    request.onerror = clearOnFail
    request.send()
    return null
  }

  let isLoaded = (url) => {
    let buf = buffers[url]
    return !!buf && buf !== nullBuffer
  }

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

  return {
    getBuffer: getBuffer,
    isLoaded: isLoaded,
    getUrl: getUrl,
  }
})