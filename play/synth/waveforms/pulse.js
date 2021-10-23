'use strict';
define(function (require) {
  let system = require('play/system')

  let wave
  return () => {
    if (!wave) {
      // From: https://github.com/chipbell4/nes-sequencer/blob/master/src/oscillators.js
      let pulseWidth = 0.03
      let real = [0]
      let imag = [0]
      for (let i = 1; i < 2048; i++) {
        let realTerm = 4 / (i * Math.PI) * Math.sin(Math.PI * i * pulseWidth)
        real.push(realTerm)
        imag.push(0)
      }
      wave = system.audio.createPeriodicWave(new Float32Array(real), new Float32Array(imag))
    }
    return wave
  }
});
