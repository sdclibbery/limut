'use strict';
define(function (require) {
  let system = require('play/system');
  let fm = require('play/fm')
  let scale = require('music/scale');
  let envelope = require('play/no-sus-envelope')
  let effects = require('play/effects')
  let param = require('player/default-param')

  return (params) => {
    let degree = parseInt(params.sound) + param(params.add, 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, param(params.oct, 4))

    let vca = envelope(params, 0.05)
    system.mix(effects(params, vca))

    let op4 = fm.op(freq*21.98/3.14, params)
    op4.connect(vca)

    let op3 = fm.op(freq*10.38/3.14, params)
    fm.connect(op3, op4, fm.flatEnv(param(window.bell3, 702)))

    let op2 = fm.op(freq*3.14/3.14, params)
    fm.connect(op2, op4, envelope(params, param(window.bell2, 386)))

    let op1 = fm.op(freq*19.03/3.14, params, 'sawtooth')
    fm.connect(op1, op2, fm.simpleEnv(param(window.bell1, 300), params, 0, 1))
    //    fm.connect(op1, op1, fm.flatEnv(param(window.bell1fb, 2))) // feedback doesnt work?
  }
});
