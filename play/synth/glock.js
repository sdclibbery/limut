'use strict';
define(function (require) {
  let system = require('play/system');
  let fm = require('play/fm')
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let pitchEffects = require('play/effects/pitch-effects')
  let waveEffects = require('play/effects/wave-effects')

  return (params) => {
    if (params.dur !== undefined && params.dur < 2) { params.dur = 2 }
    let freq = scale.paramsToFreq(params, 4)
    if (isNaN(freq)) { return }

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

    system.disconnect(params, [op1,op2,op3,op4,vca,multiosc])
    // frequencies from element433 https://youtu.be/CdPa6VLi4GQ?t=191
  }
});
