'use strict';
define(function (require) {
  let system = require('play/system')
  let {mainParam} = require('player/sub-param')
  let {evalMainParamFrame} = require('play/eval-audio-params')

  let perFrameAmp = (params, node) => {
    if (typeof mainParam(params.amp) !== 'function') { return node } // No per frame control required
    let vca = system.audio.createGain()
    evalMainParamFrame(vca.gain, params, 'amp', 1)
    node.connect(vca)
    params._destructor.disconnect(vca)
    return vca
  }

  return perFrameAmp
})
