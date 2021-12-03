'use strict';
define(function (require) {
  let system = require('play/system');
  let fm = require('play/fm')
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let pitchEffects = require('play/effects/pitch-effects')
  let {evalMainParamNow} = require('play/eval-audio-params')

  return (params) => {
    let degree = parseInt(params.sound) + evalMainParamNow(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalMainParamNow(params, 'oct', 4), evalMainParamNow(params, 'scale'))

    let vca = envelope(params, 0.04, 'full')
    let out = effects(params, vca)
    system.mix(out)

    let ops = [1,2,3,4,5,6].map(idx => {
      let op = evalMainParamNow(params, 'op'+idx, {})
      let target = evalMainParamNow(op, 'target', undefined)
      let ratio = evalMainParamNow(op, 'ratio', 1)
      let wave = evalMainParamNow(op, 'wave', 'sine')
      return {
        target: target,
        depth: evalMainParamNow(op, 'depth', 1024),
        att: evalMainParamNow(op, 'att', undefined),
        rel: evalMainParamNow(op, 'rel', 1),
        ratio: ratio,
        op: (!!target) ? fm.op(freq*ratio, params, wave) : undefined,
        idx: idx,
        env: undefined,
      }
    })

    ops = ops.map(({target, depth, att, rel, op, env}) => {
      if (!target || (target !== 'out' && ops[target].op === undefined)) return
      pitchEffects(params).connect(op.detune)
      if (target === 'out') {
        if (att === undefined) {
          op.connect(vca)
        } else {
          env = fm.simpleEnv(depth/1024, params, att, rel)
          op.connect(env)
          env.connect(vca)
        }
      } else {
        if (att === undefined) {
          env = fm.flatEnv(params, depth*freq/261.6)
        } else {
          env = fm.simpleEnv(depth*freq/261.6, params, att, rel)
        }
        fm.connect(op, ops[parseInt(target)-1].op, env)
      }
      return {op,env}
    }).filter(o => !!o)

    system.disconnect(params,
      ops.map(o=>o.op).filter(o => !!o)
      .concat(ops.map(o=>o.env).filter(o => !!o))
      .concat([vca]))
  }
});
