'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects')
  let pitchEffects = require('play/pitch-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')
  let fm = require('play/fm')

  return (params) => {
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 5), evalPerEvent(params, 'scale'))

    let vca = envelope(params, 0.018, 'pad')
    let out = effects(params, vca)
    system.mix(out)

    let op4 = fm.op(freq, params)
    pitchEffects(params).connect(op4.detune)
    op4.connect(vca)

    let op3 = fm.op(freq*7, params, 'triangle')
    fm.connect(op3, op4, fm.flatEnv(300*freq/261.6))

    let op2 = fm.op(freq, params, 'triangle')
    fm.connect(op2, op3, fm.flatEnv(700*freq/261.6))

    let op1 = fm.op(freq*1.01, params, 'triangle')
    fm.connect(op1, op4, fm.flatEnv(200*freq/261.6))

    system.disconnect(params, [op1,op2,op3,op4,vca,out])
  }
});
