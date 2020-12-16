'use strict';
define(function (require) {
  let system = require('play/system');
  let fm = require('play/fm')
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects')
  let pitchEffects = require('play/pitch-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  return (params) => {
    if (params.dur !== undefined && params.dur < 2) { params.dur = 2 }
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 4), evalPerEvent(params, 'scale'))

    let vca = envelope(params, 0.02, 'simple')
    let out = effects(params, vca)
    system.mix(out)

    let ops = [1,2,3,4,5,6].map(idx => {
      let target = evalPerEvent(params, 'op'+idx+'target', undefined)
      let ratio = evalPerEvent(params, 'op'+idx+'ratio', 1)
      let wave = evalPerEvent(params, 'op'+idx+'wave', 'sine')
      return {
        target: target,
        depth: evalPerEvent(params, 'op'+idx+'depth', 1000),
        att: evalPerEvent(params, 'op'+idx+'att', undefined),
        rel: evalPerEvent(params, 'op'+idx+'rel', 1),
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
        op.connect(vca)
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
      .concat([vca,out]))
  }
});
