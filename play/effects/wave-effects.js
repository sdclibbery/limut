'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let {mix} = require('play/effects/mix')

  let shapeEffect = (params, effect, node, count, shape) => {
    let amount = evalMainParamEvent(params, effect, 0)
    if (!amount) { return node }
    let shaper = system.audio.createWaveShaper()
    let curve = new Float32Array(2*count+1)
    curve[count] = 0
    for (let i = 1; i < count+1; i++) {
      let x = i/count
      let y = shape(x, amount, i)
      curve[count-i] = -y
      curve[count+i] = y
    }
    shaper.curve = curve
    shaper.oversample = 'none'
    node.connect(shaper)
    system.disconnect(params, [shaper,node])
    return mix(params, effect, node, shaper, 1)
  }

  let noisify = (x, amount, i) => {
    let y
    if (i%3 == 0) { y = x }
    if (i%3 == 1) { y = x-amount*4*x }
    if (i%3 == 2) { y = x+amount*4*x }
    return y
  }

  let fold = (x, a) => {
    let sgn = Math.sign(x)
    let v = Math.abs(x)*(1+a)
    return sgn * (v>1 ? 1-(v-1) : v)
  }

  let clip = (x, a) => {
    let sgn = Math.sign(x)
    let v = Math.abs(x)*(1+a*40)
    return sgn * (v>1 ? 1 : v)
  }

  return (params, node) => {
    node = shapeEffect(params, 'noisify', node, 500, noisify)
    node = shapeEffect(params, 'bits', node, 256, (x, b) => Math.pow(Math.round(Math.pow(x,1/2)*b)/b,2))
    node = shapeEffect(params, 'fold', node, 256, fold)
    node = shapeEffect(params, 'clip', node, 256, clip)
    node = shapeEffect(params, 'drive', node, 256, (x, a) => Math.atan(x*Math.max(a,0.05)*100)/(2+a))
    return node
  }
})
