'use strict';
define(function (require) {
  let system = require('play/system');
  let fm = require('play/fm')
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let waveEffects = require('play/effects/wave-effects')
  let pitchEffects = require('play/effects/pitch-effects')

  return (params) => {
    if (params.dur !== undefined && params.dur < 2) { params.dur = 2 }
    let freq = scale.paramsToFreq(params, 4)
    if (isNaN(freq)) { return }

    let vca = envelope(params, 0.03, 'simple')
    let out = effects(params, vca)
    system.mix(out)

    let op4 = fm.op(freq*21.98/3.14, params)
    pitchEffects(op4.detune, params)
    waveEffects(params, op4).connect(vca)

    let op3 = fm.op(freq*10.38/3.14, params)
    fm.connect(op3, op4, fm.flatEnv(params, 702*freq/261.6))

    let op2 = fm.op(freq*3.14/3.14, params)
    fm.connect(op2, op4, envelope(params, 386*freq/261.6, 'simple'))

    let op1 = fm.op(freq*19.03/3.14, params, 'square')
    fm.connect(op1, op2, fm.simpleEnv(300*freq/261.6, params, 0, 1))
    //    fm.connect(op1, op1, fm.flatEnv(params, 200)) // feedback doesnt work in webaudio?

    system.disconnect(params, [op1,op2,op3,op4,vca])
    // frequencies from https://www.youtube.com/watch?v=CdPa6VLi4GQ
  }
});
