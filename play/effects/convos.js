'use strict';
define(function (require) {
  let system = require('play/system')
  let {mainParam} = require('player/sub-param')
  let {mix} = require('play/effects/mix')

  let convolution = (params, node, p, length, shapeL, shapeR) => {
    if (!mainParam(params[p], 0)) { return node }
    let stereo = shapeR !== undefined
    let conv = system.audio.createConvolver()
    let ir = system.audio.createBuffer(stereo?2:1, length, system.audio.sampleRate)
    let irL = ir.getChannelData(0)
    for (var i = 0; i < length; i++) {
      irL[i] = shapeL(i, i/(length-1))
    }
    if (stereo) {
      var irR = ir.getChannelData(1)
      for (var i = 0; i < length; i++) {
        irR[i] = shapeR(i, i/(length-1))
      }
    }
    node.connect(conv)
    conv.normalize = false
    conv.buffer = ir
    params._destructor.disconnect(conv)
    return mix(params, p, node, conv, 1)
  }

  return (params, node) => {
    // node = convolution(params, node, 'convo', 1024, i => 1/16)
    // node = convolution(params, node, 'convo', 44000, i => ((i/2000)%2)/32)
    // node = convolution(params, node, 'convo', 44000, (i,x) => Math.cos(x*1024)/32)
    // node = convolution(params, node, 'convo', 44000, (i,x) => Math.cos(x*1024)/32, (i,x) => Math.sin(x*1020)/32)
    // node = convolution(params, node, 'convo', 44000, (i,x) => (Math.random()*2-1)/(i+4))
    // node = convolution(params, node, 'convo', 44000, (i,x) => (Math.random()*2-1)*x*x/32)
    // node = convolution(params, node, 'convo', 44000, (i,x) => (1-x)/32)
    // node = convolution(params, node, 'convo', 11000, (i,x) => i==0 ? 1 : x/32)
    // node = convolution(params, node, 'convo', 44000, (i,x) => (i%8800)==0?1:0)
    // node = convolution(params, node, 'convo', 44000, (i,x) => (Math.random()*2-1)*(1-x)/32)
    // node = convolution(params, node, 'convo', 44000, (i,x) => i==0?1:0, (i,x) => i==8800?1:0)
    // node = convolution(params, node, 'convo', 256, (i,x) => i==0?1:0, (i,x) => i==255?1:0)
    return node
  }
})
