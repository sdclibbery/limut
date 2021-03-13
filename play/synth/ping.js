'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  // let envelope = require('play/envelopes')
  // let effects = require('play/effects')
  // let pitchEffects = require('play/pitch-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  return (params) => {
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 5), evalPerEvent(params, 'scale'))

    
  }
})
