'use strict';
define(function (require) {
  let system = require('play/system');
  let fm = require('play/fm')
  let scale = require('music/scale');
  let envelope = require('play/no-sus-envelope')
  let effects = require('play/effects')
  let param = require('player/default-param')

  return (params) => {
    if (params.dur !== undefined && params.dur < 2) { params.dur = 2 }
    let degree = parseInt(params.sound) + param(params.add, 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, param(params.oct, 4), params.scale)

    let vca = envelope(params, 0.02)
    let out = effects(params, vca)
    system.mix(out)

    let op4 = fm.op(freq, params)
    op4.connect(vca)

    let op3 = fm.op(freq*14, params)
    op3.connect(vca)

    let op2 = fm.op(freq, params)
    op2.connect(vca)

    let op1 = fm.op(freq*5, params, 'square')
    fm.connect(op1, op2, fm.simpleEnv(3000*freq/261.6, params, 0, 0.5))

    system.disconnect(params, [op1,op2,op3,op4,vca,out])
    // frequencies from element433 https://youtu.be/CdPa6VLi4GQ?t=191
  }
});
