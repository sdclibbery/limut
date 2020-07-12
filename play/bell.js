'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/no-sus-envelope')
  let effects = require('play/effects')
  let param = require('player/default-param')

  let simpleEnv = (gain, params, attack, release) => {
    attack *= params.beat.duration
    release *= params.beat.duration
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(params.time)
    vca.gain.setValueAtTime(0, params.time)
    vca.gain.linearRampToValueAtTime(gain, params.time + attack)
    vca.gain.linearRampToValueAtTime(0, params.time + attack+release)
    return vca
  }
  let flatEnv = (gain) => {
    let vca = system.audio.createGain();
    vca.gain.value = gain
    return vca
  }
  let fmOp = (freq, params, wave) => {
    let vco = system.audio.createOscillator()
    vco.type = wave || 'sine';
    vco.frequency.value = freq
    vco.start(params.time)
    vco.stop(params.endTime)
    return vco
  }
  let fmConnect = (modulator, carrier, envelope) => {
    modulator.connect(envelope)
    envelope.connect(carrier.frequency)
  }
  return (params) => {
    let degree = parseInt(params.sound) + param(params.add, 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, param(params.oct, 4))

    let vca = envelope(params, 0.05)
    system.mix(effects(params, vca))

    let op4 = fmOp(freq*21.98/3.14, params)
    op4.connect(vca)

    let op3 = fmOp(freq*10.38/3.14, params)
    fmConnect(op3, op4, flatEnv(param(window.bell3, 702)))

    let op2 = fmOp(freq*3.14/3.14, params)
    fmConnect(op2, op4, envelope(params, param(window.bell2, 386)))

    let op1 = fmOp(freq*19.03/3.14, params, 'sawtooth')
    fmConnect(op1, op2, simpleEnv(param(window.bell1, 300), params, 0, 1))
    //    fmConnect(op1, op1, flatEnv(param(window.bell1fb, 2))) // feedback doesnt work?
  }
});
