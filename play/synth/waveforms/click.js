'use strict';
define(function (require) {
  let system = require('play/system');

  let clickBuffer
  let getBuffer = () => {
    if (clickBuffer === undefined) {
      const sampleRate = system.audio.sampleRate
      clickBuffer = system.audio.createBuffer(1, 0.001*sampleRate, sampleRate)
      let data = clickBuffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) {
        data[i] = 1
      }
    }
    return clickBuffer
  }

  let click = () => {
    let source = system.audio.createBufferSource()
    source.buffer = getBuffer()
    source.loop = false
    return source
  }

  return {
    getBuffer: getBuffer,
    click: click
  }
});
