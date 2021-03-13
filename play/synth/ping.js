'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  // let effects = require('play/effects')
  // let pitchEffects = require('play/pitch-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  let env = (params, gainBase) => {
    let dur = Math.max(0.01, evalPerEvent(params, 'sus', evalPerEvent(params, 'dur', 0.25)))
    let attack = evalPerEvent(params, 'att', 0.09) * params.beat.duration
    params.time -= Math.min(attack, 0.05)
    let decay = evalPerEvent(params, 'decay', 0.08*dur) * params.beat.duration
    let release = evalPerEvent(params, 'rel', params.sus||dur) * params.beat.duration
    let amp = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    params.endTime = params.time + attack+decay+release
    return amp
  }
  const synthDef = Uint8Array.from(
    // SynthDef("ping", {|amp=1, freq=440|
    //   var sn = SinOsc.ar(freq) * amp;
    //   Out.ar(0, sn);
    // }).asBytes.printOn(Post);    
    [83, 67, 103, 102, 0, 0, 0, 2, 0, 1, 4, 112, 105, 110, 103, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 63, -128, 0, 0, 67, -36, 0, 0, 0, 0, 0, 2, 3, 97, 109, 112, 0, 0, 0, 0, 4, 102, 114, 101, 113, 0, 0, 0, 1, 0, 0, 0, 4, 7, 67, 111, 110, 116, 114, 111, 108, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 1, 1, 6, 83, 105, 110, 79, 115, 99, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, -1, -1, -1, -1, 0, 0, 0, 0, 2, 12, 66, 105, 110, 97, 114, 121, 79, 112, 85, 71, 101, 110, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 79, 117, 116, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0 ]
  )
  return (params) => {
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 5), evalPerEvent(params, 'scale'))
    let amp = env(params, 0.1)

    if (synthDef.done === undefined) {
      system.sc.sendOSC_t('/d_recv', 'b', synthDef)
      synthDef.done = true
    }
    let id = system.sc.play(params.time, 'ping', amp, freq)
    system.sc.free(params.endTime, id)
  }
})
