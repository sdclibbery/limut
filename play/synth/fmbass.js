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
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 2), evalPerEvent(params, 'scale'))

    let vca = envelope(params, 0.06, 'full')
    let out = effects(params, vca)
    system.mix(out)

    let op1 = fm.op(freq, params)
    pitchEffects(params).connect(op1.detune)
    op1.connect(vca)

    let op2 = fm.op(freq*1/2, params)
    fm.connect(op2, op1, fm.simpleEnv(1024*freq/261.6, params, 0, 4))

    let op3 = fm.op(freq*1, params)
    fm.connect(op3, op1, fm.simpleEnv(768*freq/261.6, params, 0, 3/4))

    let op4 = fm.op(freq*2, params)
    fm.connect(op4, op1, fm.simpleEnv(768*freq/261.6, params, 0, 4))

    system.disconnect(params, [op1,op2,op3,op4,vca,out])
  }
});
