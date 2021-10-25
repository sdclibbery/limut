'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let pitchEffects = require('play/effects/pitch-effects')
  let waveEffects = require('play/effects/wave-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')
  let fm = require('play/fm')

  return (params) => {
    let freq = scale.paramsToFreq(params, 5)
    if (isNaN(freq)) { return }

    let vca = envelope(params, 0.018, 'pad')
    let out = effects(params, vca)
    system.mix(out)

    let op4 = fm.op(freq, params)
    pitchEffects(params).connect(op4.detune)
    waveEffects(params, op4).connect(vca)

    let op3 = fm.op(freq*7, params, 'triangle')
    fm.connect(op3, op4, fm.flatEnv(params, 300*freq/261.6))

    let op2 = fm.op(freq, params, 'triangle')
    fm.connect(op2, op3, fm.flatEnv(params, 700*freq/261.6))

    let op1 = fm.op(freq*1.01, params, 'triangle')
    fm.connect(op1, op4, fm.flatEnv(params, 200*freq/261.6))

    system.disconnect(params, [op1,op2,op3,op4,vca])
  }
});
