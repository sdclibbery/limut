'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  let noisify = (params, node) => {
    let amount = evalPerEvent(params, 'noisify', 0)
    if (!amount) { return node }
    let shaper = system.audio.createWaveShaper()
    let count = 500
    let noisifyCurve = new Float32Array(2*count+1)
    noisifyCurve[count] = 0
    for (let i = 1; i < count+1; i++) {
      let x = i/count
      let y
      if (i%3 == 0) { y = x }
      if (i%3 == 1) { y = x-amount*2*x }
      if (i%3 == 2) { y = x-amount*2*x/2 }
      noisifyCurve[count-i] = -y
      noisifyCurve[count+i] = y
    }
    shaper.curve = noisifyCurve
    shaper.oversample = 'none'
    node.connect(shaper)
    system.disconnect(params, [shaper,node])
    return shaper
  }

  return (params, node) => {
    node = noisify(params, node)
    return node
  }
})
