'use strict';
define(function (require) {
  let system = require('play/system');

  let whiteBuffer
  let white = () => {
    if (whiteBuffer === undefined) {
      let rate = system.audio.sampleRate
      whiteBuffer = system.audio.createBuffer(2, rate*2, rate)
      for (let channel = 0; channel < whiteBuffer.numberOfChannels; channel++) {
        const data = whiteBuffer.getChannelData(channel)
        for (let i = 0; i < whiteBuffer.length; i++) {
          data[i] = Math.random() * 2 - 1
        }
      }
    }
    let source = system.audio.createBufferSource()
    source.buffer = whiteBuffer
    source.loop = true
    return source
  }

  return {
    white: white
  }
});
