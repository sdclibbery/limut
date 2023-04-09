'use strict';
define(function (require) {
  let system = require('play/system')

  function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
  }

  return (duration, curve) => {
    let reverb = system.audio.createConvolver()
    var rate = system.audio.sampleRate
    var length = rate * duration
    var impulse = system.audio.createBuffer(2, length, rate)
    var impulseL = impulse.getChannelData(0)
    var impulseR = impulse.getChannelData(1)
    let random = mulberry32(1) // Same random seed every time
    for (var i = 0; i < length; i++) {
      impulseL[i] = (random() * 2 - 1) * Math.pow(1 - i / length, curve)
      impulseR[i] = (random() * 2 - 1) * Math.pow(1 - i / length, curve)
    }
    reverb.buffer = impulse
    return reverb
  }

})
