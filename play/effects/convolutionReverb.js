'use strict';
define(function (require) {
  // let system = require('play/system')

  // return (duration, curve) => {
  return (system, duration, curve) => {
    let reverb = system.audio.createConvolver()
    var rate = system.audio.sampleRate
    var length = rate * duration
    var impulse = system.audio.createBuffer(2, length, rate)
    var impulseL = impulse.getChannelData(0)
    var impulseR = impulse.getChannelData(1)
    for (var i = 0; i < length; i++) {
      impulseL[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, curve)
      impulseR[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, curve)
    }
    reverb.buffer = impulse
    return reverb
  }

})
