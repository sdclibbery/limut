'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  // let effects = require('play/effects')
  // let pitchEffects = require('play/pitch-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  let envTemp = (params, gainBase) => {
    let dur = Math.max(0.01, evalPerEvent(params, 'sus', evalPerEvent(params, 'dur', 0.25)))
    let attack = evalPerEvent(params, 'att', 0.09) * params.beat.duration
    params.time -= Math.min(attack, 0.05)
    let decay = evalPerEvent(params, 'decay', 0.08*dur) * params.beat.duration
    let release = evalPerEvent(params, 'rel', params.sus||dur) * params.beat.duration
    let amp = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    params.endTime = params.time + attack+decay+release
    return amp
  }
  const synthDefSimpleEnv = Uint8Array.from(
    // SynthDef("simpleEnv", { |out, att=0.5, amp=0.1, rel=1|
    //   ReplaceOut.ar(out, In.ar(out, 2) * EnvGen.kr(Env.perc(att, rel, amp, -4), doneAction: Done.freeGroup));
    // }).add.asBytes.postcs();
    [ 83, 67, 103, 102, 0, 0, 0, 2, 0, 1, 9, 115, 105, 109, 112, 108, 101, 69, 110, 118, 0, 0, 0, 7, 63, -128, 0, 0, 0, 0, 0, 0, 65, 96, 0, 0, 64, 0, 0, 0, -62, -58, 0, 0, 64, -96, 0, 0, -64, -128, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 63, 0, 0, 0, 61, -52, -52, -51, 63, -128, 0, 0, 0, 0, 0, 4, 3, 111, 117, 116, 0, 0, 0, 0, 3, 97, 116, 116, 0, 0, 0, 1, 3, 97, 109, 112, 0, 0, 0, 2, 3, 114, 101, 108, 0, 0, 0, 3, 0, 0, 0, 6, 7, 67, 111, 110, 116, 114, 111, 108, 1, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 1, 1, 1, 1, 2, 73, 110, 2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 6, 69, 110, 118, 71, 101, 110, 1, 0, 0, 0, 17, 0, 0, 0, 1, 0, 0, -1, -1, -1, -1, 0, 0, 0, 0, -1, -1, -1, -1, 0, 0, 0, 0, -1, -1, -1, -1, 0, 0, 0, 1, -1, -1, -1, -1, 0, 0, 0, 0, -1, -1, -1, -1, 0, 0, 0, 2, -1, -1, -1, -1, 0, 0, 0, 1, -1, -1, -1, -1, 0, 0, 0, 3, -1, -1, -1, -1, 0, 0, 0, 4, -1, -1, -1, -1, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, -1, -1, -1, -1, 0, 0, 0, 5, -1, -1, -1, -1, 0, 0, 0, 6, -1, -1, -1, -1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 3, -1, -1, -1, -1, 0, 0, 0, 5, -1, -1, -1, -1, 0, 0, 0, 6, 1, 12, 66, 105, 110, 97, 114, 121, 79, 112, 85, 71, 101, 110, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 12, 66, 105, 110, 97, 114, 121, 79, 112, 85, 71, 101, 110, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 2, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 2, 10, 82, 101, 112, 108, 97, 99, 101, 79, 117, 116, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0 ]
  )
  const synthDef = Uint8Array.from(
    // SynthDef("ping", {|freq=440|
    //   Out.ar(0, SinOsc.ar(freq));
    // }).add.asBytes.printOn(Post);
    [ 83, 67, 103, 102, 0, 0, 0, 2, 0, 1, 4, 112, 105, 110, 103, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 67, -36, 0, 0, 0, 0, 0, 1, 4, 102, 114, 101, 113, 0, 0, 0, 0, 0, 0, 0, 3, 7, 67, 111, 110, 116, 114, 111, 108, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 6, 83, 105, 110, 79, 115, 99, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, -1, -1, -1, 0, 0, 0, 0, 2, 3, 79, 117, 116, 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0 ]
    )
  return (params) => {
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 5), evalPerEvent(params, 'scale'))
    let amp = envTemp(params, 0.1)

    if (synthDef.done === undefined) {
      system.sc.addSynthDef(synthDef)
      system.sc.addSynthDef(synthDefSimpleEnv)
      synthDef.done = true
    }

    let play = system.sc.play('ping', freq)
    let env = system.sc.nextId()
    system.sc.bundle.push(system.sc.oscMsg('/s_new', 'siiisf', 'simpleEnv', env, 3, play, 'amp', amp))
    system.sc.commit(params.time)
  }
})
