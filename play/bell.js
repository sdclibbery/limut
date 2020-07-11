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
  return (params) => {
    let degree = parseInt(params.sound) + param(params.add, 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, param(params.oct, 4))
//    let detuneSemis = param(params.detune, 0.1)

    let vca = envelope(params, 0.01)
    system.mix(effects(params, vca))

    let vco4 = system.audio.createOscillator()
    vco4.type = 'sine';
    vco4.frequency.value = freq*21.98/3.14
    vco4.connect(vca)
    vco4.start(params.time)
    vco4.stop(params.endTime)

    let vco3 = system.audio.createOscillator()
    vco3.type = 'sine';
    vco3.frequency.value = freq*10.38/3.14
    vco3.detune.value = 1
    let vco3_4gain = flatEnv(700)
    vco3.connect(vco3_4gain)
    vco3_4gain.connect(vco4.detune)
    vco3.start(params.time)
    vco3.stop(params.endTime)

    let vco2 = system.audio.createOscillator()
    vco2.type = 'sine';
    vco2.frequency.value = freq
    vco2.detune.value = 3
    let vco2_4gain = simpleEnv(150, params, 0, 0.7)
    vco2.connect(vco2_4gain)
    vco2_4gain.connect(vco4.detune)
    vco2.start(params.time)
    vco2.stop(params.endTime)

    let vco1 = system.audio.createOscillator()
    vco1.type = 'sine';
    vco1.frequency.value = freq*19.03/3.14
    vco1.detune.value = 1
    let vco1_4gain = simpleEnv(10000, params, 0, 0.3)
    vco1.connect(vco1_4gain)
    vco1_4gain.connect(vco1.detune)
    vco1_4gain.connect(vco4.detune)
    vco1.start(params.time)
    vco1.stop(params.endTime)
  }
});
