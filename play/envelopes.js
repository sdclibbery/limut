'use strict';
define(function (require) {
  let system = require('play/system');
  let param = require('player/default-param')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  const synthDefSimpleEnv = Uint8Array.from(
    // SynthDef("simple-env", { |bus=10,amp=0.1,att=0.5,rel=1|
    //   ReplaceOut.ar(bus, In.ar(bus, 2) * EnvGen.kr(Env.perc(att, rel, amp, -2), doneAction: Done.freeGroup));
    // }).add.asBytes.postcs();
    [ 83, 67, 103, 102, 0, 0, 0, 2, 0, 1, 10, 115, 105, 109, 112, 108, 101, 45, 101, 110, 118, 0, 0, 0, 7, 63, -128, 0, 0, 0, 0, 0, 0, 65, 96, 0, 0, 64, 0, 0, 0, -62, -58, 0, 0, 64, -96, 0, 0, -64, 0, 0, 0, 0, 0, 0, 4, 65, 32, 0, 0, 61, -52, -52, -51, 63, 0, 0, 0, 63, -128, 0, 0, 0, 0, 0, 4, 3, 98, 117, 115, 0, 0, 0, 0, 3, 97, 109, 112, 0, 0, 0, 1, 3, 97, 116, 116, 0, 0, 0, 2, 3, 114, 101, 108, 0, 0, 0, 3, 0, 0, 0, 6, 7, 67, 111, 110, 116, 114, 111, 108, 1, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 1, 1, 1, 1, 2, 73, 110, 2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 6, 69, 110, 118, 71, 101, 110, 1, 0, 0, 0, 17, 0, 0, 0, 1, 0, 0, -1, -1, -1, -1, 0, 0, 0, 0, -1, -1, -1, -1, 0, 0, 0, 0, -1, -1, -1, -1, 0, 0, 0, 1, -1, -1, -1, -1, 0, 0, 0, 0, -1, -1, -1, -1, 0, 0, 0, 2, -1, -1, -1, -1, 0, 0, 0, 1, -1, -1, -1, -1, 0, 0, 0, 3, -1, -1, -1, -1, 0, 0, 0, 4, -1, -1, -1, -1, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, -1, -1, -1, -1, 0, 0, 0, 5, -1, -1, -1, -1, 0, 0, 0, 6, -1, -1, -1, -1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 3, -1, -1, -1, -1, 0, 0, 0, 5, -1, -1, -1, -1, 0, 0, 0, 6, 1, 12, 66, 105, 110, 97, 114, 121, 79, 112, 85, 71, 101, 110, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 12, 66, 105, 110, 97, 114, 121, 79, 112, 85, 71, 101, 110, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 2, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 2, 10, 82, 101, 112, 108, 97, 99, 101, 79, 117, 116, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0 ]
  )
  let simpleEnvelope = (env, lastNode, params, gainBase) => {
    let dur = Math.max(0.01, evalPerEvent(params, 'sus', evalPerEvent(params, 'dur', 0.25)))
    let attack = evalPerEvent(params, 'att', 0.09) * params.beat.duration
    params.time -= Math.min(attack, 0.05)
    let decay = evalPerEvent(params, 'decay', 0.08*dur) * params.beat.duration
    let release = evalPerEvent(params, 'rel', params.sus||dur) * params.beat.duration
    let amp = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    params.endTime = params.time + attack+decay+release
    system.sc.addSynthDef(synthDefSimpleEnv)
    return system.sc.oscMsg('/s_new', 'siiisisfsfsf', 'simple-env', env, 3, lastNode, 'bus', system.sc.bus, 'amp', amp, 'att', attack, 'rel', release)
  }

  let fullEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, param(params.sus, param(params.dur, 0.25)))
    let attack = param(params.att, 0.09) * params.beat.duration
    params.time -= Math.min(attack, 0.05)
    let decay = param(params.decay, 0.08*dur) * params.beat.duration
    let sustain = param(params.sus, dur) * params.beat.duration - decay
    let susLevel = param(params.suslevel, 0.8)
    let release = param(params.rel, 0.1*dur) * params.beat.duration
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    // TODO!!!
  }
  
  let padEnvelope = (params, gainBase) => {
    let dur = Math.max(evalPerEvent(params, 'sus', evalPerEvent(params, 'dur', 0.25)), 0.01)
    let attack = Math.max(evalPerEvent(params, 'att', dur/2) * params.beat.duration, 0.001)
    let release = Math.max(evalPerEvent(params, 'rel', dur/2) * params.beat.duration, 0.001)
    let sus = Math.max(dur*params.beat.duration - attack, 0.001)
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    // TODO!!!
  }

  return (env, lastNode, params, gainBase, defaultEnvelope) => {
    let envelope = evalPerEvent(params, "envelope", defaultEnvelope)
    switch (envelope) {
      case 'simple': return simpleEnvelope(env, lastNode, params, gainBase)
      case 'pad': return padEnvelope(env, lastNode, params, gainBase)
    }
    return fullEnvelope(env, lastNode, params, gainBase)
  }
})
