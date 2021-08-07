'use strict';
define(function (require) {
  let system = require('play/system');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let waveEffects = require('play/effects/wave-effects')
  let consoleOut = require('console')

  let stream
  let getStream = () => {
    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
        latency: 0
      }
    }).then(s => {
      consoleOut(`: Using External audio: ${s.getTracks()[0].label}`)
      stream=s
    })
  }

  return (params) => {
    if (!stream) {
      getStream()
      return
    }
    let vca = envelope(params, 0.5, 'pad')
    system.mix(effects(params, vca))
    let audioIn = system.audio.createMediaStreamSource(stream)
    waveEffects(params, audioIn).connect(vca)
    system.disconnect(params, [audioIn, vca])
  }
})
