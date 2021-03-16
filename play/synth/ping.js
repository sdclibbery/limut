'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  // let effects = require('play/effects')
  // let pitchEffects = require('play/pitch-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  const synthDef = Uint8Array.from(
    // SynthDef("ping", {|bus=10,freq=440|
    //   Out.ar(bus, SinOsc.ar(freq));
    // }).add.asBytes.postcs();
    [ 83, 67, 103, 102, 0, 0, 0, 2, 0, 1, 4, 112, 105, 110, 103, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 65, 32, 0, 0, 67, -36, 0, 0, 0, 0, 0, 2, 3, 98, 117, 115, 0, 0, 0, 0, 4, 102, 114, 101, 113, 0, 0, 0, 1, 0, 0, 0, 3, 7, 67, 111, 110, 116, 114, 111, 108, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 1, 1, 6, 83, 105, 110, 79, 115, 99, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, -1, -1, -1, -1, 0, 0, 0, 0, 2, 3, 79, 117, 116, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0 ]
    )
  return (params) => {
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 5), evalPerEvent(params, 'scale'))

    system.sc.addSynthDef(synthDef)
    let play = system.sc.play('ping', freq)
    let env = system.sc.nextNode()
    system.sc.bundle.push(envelope(env, play, params, 0.1, 'simple'))
    system.sc.commit(env, params.time)
  }
})
