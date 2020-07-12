'use strict';
define(function (require) {
  let system = require('play/system');

  let fm = {}

  fm.simpleEnv = (gain, params, attack, release) => {
    attack *= params.beat.duration
    release *= params.beat.duration
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(params.time)
    vca.gain.setValueAtTime(0, params.time)
    vca.gain.linearRampToValueAtTime(gain, params.time + attack)
    vca.gain.linearRampToValueAtTime(0, params.time + attack+release)
    return vca
  }

  fm.flatEnv = (gain) => {
    let vca = system.audio.createGain();
    vca.gain.value = gain
    return vca
  }

  fm.op = (freq, params, wave) => {
    let vco = system.audio.createOscillator()
    vco.type = wave || 'sine';
    vco.frequency.value = freq
    vco.start(params.time)
    vco.stop(params.endTime)
    return vco
  }

  fm.connect = (modulator, carrier, envelope) => {
    modulator.connect(envelope)
    envelope.connect(carrier.frequency)
  }

  return fm
});
