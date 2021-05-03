'use strict';
define(function (require) {
  let system = require('play/system');
  let fm = require('play/fm')
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects')
  let pitchEffects = require('play/pitch-effects')
  let waveEffects = require('play/wave-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  return (params) => {
    if (params.dur !== undefined && params.dur < 2) { params.dur = 2 }
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 4), evalPerEvent(params, 'scale'), evalPerEvent(params, 'sharp', 0))

    let vca = envelope(params, 0.06, 'simple')
    let out = effects(params, vca)
    system.mix(out)

    let multiosc = system.audio.createGain()
    multiosc.gain.value = 1/3
    waveEffects(params, multiosc).connect(vca)

    let op4 = fm.op(freq, params)
    pitchEffects(params).connect(op4.detune)
    op4.connect(multiosc)

    let op3 = fm.op(freq*14, params)
    pitchEffects(params).connect(op3.detune)
    op3.connect(multiosc)

    let op2 = fm.op(freq, params)
    pitchEffects(params).connect(op2.detune)
    op2.connect(multiosc)

    let op1 = fm.op(freq*5, params, 'square')
    fm.connect(op1, op2, fm.simpleEnv(3000*freq/261.6, params, 0, 0.5))

    system.disconnect(params, [op1,op2,op3,op4,vca,out,multiosc])
    // frequencies from element433 https://youtu.be/CdPa6VLi4GQ?t=191
  }
});
