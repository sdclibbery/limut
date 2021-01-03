'use strict';
define(function (require) {
  let system = require('play/system');
  let fm = require('play/fm')
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects')
  let pitchEffects = require('play/pitch-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  return (params) => {
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 5), evalPerEvent(params, 'scale'))

    if (params.att === undefined) { params.att = 0 }
    if (params.rel === undefined) { params.rel = params.dur }
    let vca = envelope(params, 0.02, 'full')
    let out = effects(params, vca)
    system.mix(out)

    let op1 = fm.op(freq, params)
    pitchEffects(params).connect(op1.detune)
    op1.connect(vca)

    let op2 = fm.op(freq*3.53, params)
    fm.connect(op2, op1, fm.simpleEnv(512*freq/261.6, params, 0, 2))

    let op3 = fm.op(freq, params)
    pitchEffects(params).connect(op3.detune)
    op3.connect(vca)

    let op4 = fm.op(freq*2, params)
    fm.connect(op4, op3, fm.simpleEnv(512*freq/261.6, params, 0, 2))

    system.disconnect(params, [op1,op2,op3,op4,vca,out])
  }
});
