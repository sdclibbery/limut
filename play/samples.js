'use strict';
define(function (require) {
  let system = require('play/system');
  if (!system.audio) { return ()=>{} } // ???

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

  let isLoaded = (url) => {
    let buf = buffers[url]
    return !!buf && buf !== nullBuffer
  }

  return {
    getBuffer: getBuffer,
    isLoaded: isLoaded,
  }
})