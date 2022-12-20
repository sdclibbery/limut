'use strict';
define(function (require) {
  let system = require('play/system');

  let fm = {}

  fm.simpleEnv = (gain, params, attack, release) => {
    attack *= params.beat.duration
    release *= params.beat.duration
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(params._time)
    vca.gain.setValueAtTime(0, params._time)
    vca.gain.linearRampToValueAtTime(gain, params._time + attack)
    vca.gain.linearRampToValueAtTime(0, params._time + attack+release)
    system.disconnect(params, [vca])
    return vca
  }

  fm.flatEnv = (params, gain) => {
    let vca = system.audio.createGain();
    vca.gain.value = gain
    system.disconnect(params, [vca])
    return vca
  }

  let wave
  let noiseWaveFft = () => {
    if (!wave) {
      let real = [0]
      let imag = [0]
      for (let i = 1; i < 256; i++) {
        real.push(Math.random()/(1+i))
        imag.push(0)
      }
      wave = system.audio.createPeriodicWave(new Float32Array(real), new Float32Array(imag))
    }
    return wave
  }

  fm.op = (freq, params, wave) => {
    let vco
    if (wave === 'noise') {
      vco = system.audio.createOscillator()
      vco.setPeriodicWave(noiseWaveFft())
    } else {
      vco = system.audio.createOscillator()
      vco.type = wave || 'sine';
    }
    vco.frequency.value = freq
    vco.start(params._time)
    vco.stop(params.endTime)
    return vco
  }

  fm.connect = (modulator, carrier, envelope) => {
    modulator.connect(envelope)
    envelope.connect(carrier.frequency)
  }

  return fm
});
