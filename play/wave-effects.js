'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  let shapeEffect = (params, effect, node, count, shape) => {
    let amount = evalPerEvent(params, effect, 0)
    if (!amount) { return node }
    let shaper = system.audio.createWaveShaper()
    let noisifyCurve = new Float32Array(2*count+1)
    noisifyCurve[count] = 0
    for (let i = 1; i < count+1; i++) {
      let x = i/count
      let y = shape(x, amount, i)
      noisifyCurve[count-i] = -y
      noisifyCurve[count+i] = y
    }
    shaper.curve = noisifyCurve
    shaper.oversample = 'none'
    node.connect(shaper)
    system.disconnect(params, [shaper,node])
    return shaper
  }

  let noisify = (x, amount, i) => {
    let y
    if (i%3 == 0) { y = x }
    if (i%3 == 1) { y = x-amount*4*x }
    if (i%3 == 2) { y = x+amount*4*x }
    return y
  }

  return (params, node) => {
    node = shapeEffect(params, 'noisify', node, 500, noisify)
    node = shapeEffect(params, 'drive', node, 256, (x, a) => Math.atan(x*Math.max(a,0.05)*100)/(5+a))
    node = shapeEffect(params, 'bits', node, 256, (x, b) => Math.floor(x*b)/b)
    return node
  }
})
