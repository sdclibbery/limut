'use strict';
define(function (require) {
  let system = require('play/system');
  let fm = require('play/fm')
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let waveEffects = require('play/effects/wave-effects')
  let pitchEffects = require('play/effects/pitch-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  return (params) => {
    if (params.dur !== undefined && params.dur < 3/2) { params.dur = 3/2 }
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 4), evalPerEvent(params, 'scale'), evalPerEvent(params, 'sharp', 0))

    let vca = envelope(params, 0.06, 'simple')
    let out = effects(params, vca)
    system.mix(out)

    let op4 = fm.op(freq*2, params)
    pitchEffects(params).connect(op4.detune)
    let op4We = waveEffects(params, op4)
    let op4Env = fm.simpleEnv(0.3, params, 1/8, 3/4)
    op4We.connect(op4Env)
    op4Env.connect(vca)

    let op3 = fm.op(freq*9.42, params, 'noise')
    fm.connect(op3, op4, fm.simpleEnv(200*freq/261.6, params, 0, 1))

    let op2 = fm.op(freq*0.5, params)
    pitchEffects(params).connect(op2.detune)
    waveEffects(params, op2).connect(vca)

    let op1 = fm.op(freq*5.19, params, 'saw')
    fm.connect(op1, op2, fm.simpleEnv(800*freq/261.6, params, 0, 1/10))

    let op0 = fm.op(freq/131072, params, 'noise')
    fm.connect(op1, op2, fm.flatEnv(params, 15*freq/261.6))

    system.disconnect(params, [op0,op1,op2,op3,op4,vca])
    // frequencies from https://www.youtube.com/watch?v=dXo_493fEpU
  }
});
