'use strict';
define(function (require) {
  let system = require('play/system');
  let fm = require('play/fm')
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let {fxMixChain} = require('play/effects/fxMixChain')
  let waveEffects = require('play/effects/wave-effects')
  let pitchEffects = require('play/effects/pitch-effects')
  let {evalSubParamEvent} = require('play/eval-audio-params')
  let {findNonChordParams} = require('player/non-chord-params')
  let perFrameAmp = require('play/effects/perFrameAmp')

  let createOp = (params, idx, id, freq) => {
    let target = evalSubParamEvent(params, id, 'target', undefined)
    let ratio = evalSubParamEvent(params, id, 'ratio', 1)
    let wave = evalSubParamEvent(params, id, 'wave', 'sine')
    return {
      target: target,
      targetIdx: parseInt(target)-1,
      depth: evalSubParamEvent(params, id, 'depth', 1),
      att: evalSubParamEvent(params, id, 'att', undefined),
      rel: evalSubParamEvent(params, id, 'rel', 1),
      ratio: ratio,
      op: (!!target) ? fm.op(freq*ratio, params, wave) : undefined,
      idx: idx,
      env: undefined,
    }
  }

  return (params) => {
    let freq = scale.paramsToFreq(params, 4)
    if (isNaN(freq)) { return }

    let vca = envelope(params, 0.04, 'full')
    fxMixChain(params, perFrameAmp(params, vca))
    let vcaMix = system.audio.createGain()

    let ops = findNonChordParams(params, 'op')
    .map((id, idx) => createOp(params, idx, id, freq))
    // console.log(ops.length) // Use the length to prove that the array is coming through as a non-chord array

    ops = ops.map(({target, depth, att, rel, op, env, targetIdx}) => {
      if (!target || (target !== 'out' && ops[targetIdx].op === undefined)) return
      pitchEffects(op.detune, params)
      if (target === 'out') {
        if (att === undefined) {
          if (depth === 1) {
            op.connect(vcaMix)
          } else {
            env = fm.flatEnv(params, depth)
            op.connect(env)
            env.connect(vcaMix)
          }
        } else {
          env = fm.simpleEnv(depth, params, att, rel)
          op.connect(env)
          env.connect(vcaMix)
        }
      } else {
        if (att === undefined) {
          env = fm.flatEnv(params, depth*1024*freq/261.6)
        } else {
          env = fm.simpleEnv(depth*1024*freq/261.6, params, att, rel)
        }
        fm.connect(op, ops[targetIdx].op, env)
      }
      if (!!env) { params._destructor.disconnect(env) }
      params._destructor.disconnect(op)
      params._destructor.stop(op)
      return {op,env}
    }).filter(o => !!o)

    waveEffects(params, effects(params, vcaMix)).connect(vca)
    params._destructor.disconnect(vca, vcaMix)
  }
});
