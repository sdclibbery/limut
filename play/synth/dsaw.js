'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects')
  let pitchEffects = require('play/pitch-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  const synthDef = Uint8Array.from(
    // SynthDef("dsaw", {|bus=10,freq=440,detune=0.1|
    //   var sig = Saw.ar(freq * (2 ** (0.0 * detune/12)))
    //           + Saw.ar(freq * (2 ** (0.7 * detune/12)))
    //           + Saw.ar(freq * (2 ** (1.0 * detune/12)));
    //   Out.ar(bus, sig);
    // }).add.asBytes.postcs();
    [ 83, 67, 103, 102, 0, 0, 0, 2, 0, 1, 4, 100, 115, 97, 119, 0, 0, 0, 3, 63, 51, 51, 51, 65, 64, 0, 0, 64, 0, 0, 0, 0, 0, 0, 3, 65, 32, 0, 0, 67, -36, 0, 0, 61, -52, -52, -51, 0, 0, 0, 3, 3, 98, 117, 115, 0, 0, 0, 0, 4, 102, 114, 101, 113, 0, 0, 0, 1, 6, 100, 101, 116, 117, 110, 101, 0, 0, 0, 2, 0, 0, 0, 13, 7, 67, 111, 110, 116, 114, 111, 108, 1, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 1, 1, 1, 3, 83, 97, 119, 2, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 12, 66, 105, 110, 97, 114, 121, 79, 112, 85, 71, 101, 110, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 2, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 12, 66, 105, 110, 97, 114, 121, 79, 112, 85, 71, 101, 110, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 4, 0, 0, 0, 2, 0, 0, 0, 0, -1, -1, -1, -1, 0, 0, 0, 1, 1, 12, 66, 105, 110, 97, 114, 121, 79, 112, 85, 71, 101, 110, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 25, -1, -1, -1, -1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 1, 12, 66, 105, 110, 97, 114, 121, 79, 112, 85, 71, 101, 110, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 4, 0, 0, 0, 0, 1, 3, 83, 97, 119, 2, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 2, 12, 66, 105, 110, 97, 114, 121, 79, 112, 85, 71, 101, 110, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 4, 0, 0, 0, 0, 0, 0, 0, 2, -1, -1, -1, -1, 0, 0, 0, 1, 1, 12, 66, 105, 110, 97, 114, 121, 79, 112, 85, 71, 101, 110, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 25, -1, -1, -1, -1, 0, 0, 0, 2, 0, 0, 0, 7, 0, 0, 0, 0, 1, 12, 66, 105, 110, 97, 114, 121, 79, 112, 85, 71, 101, 110, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 8, 0, 0, 0, 0, 1, 3, 83, 97, 119, 2, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 2, 4, 83, 117, 109, 51, 2, 0, 0, 0, 3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 3, 79, 117, 116, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11, 0, 0, 0, 0, 0, 0 ]
    )
  return (params) => {
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 4), evalPerEvent(params, 'scale'))
    let detuneSemis = evalPerEvent(params, 'detune', 0.1)

    system.sc.addSynthDef(synthDef)
    let play = system.sc.play('dsaw', freq, detuneSemis)
    let env = system.sc.nextNode()
    system.sc.bundle.push(envelope(env, play, params, 0.1, 'full'))
    system.sc.commit(env, params.time)
  }
});
