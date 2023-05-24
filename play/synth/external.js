'use strict';
define(function (require) {
  let system = require('play/system');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let {fxMixChain} = require('play/effects/fxMixChain')
  let waveEffects = require('play/effects/wave-effects')
  let consoleOut = require('console')
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let perFrameAmp = require('play/effects/perFrameAmp')

  let stream
  let getStream = () => {
    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        googAutoGainControl: false,
        googNoiseSuppression: false,
        googHighpassFilter: false,
        autoGainControl: false,
        noiseSuppression: false,
        latency: 0
      }
    }).then(s => {
      s.getTracks().forEach((t,i) => {
        consoleOut(`: External audio: Track ${i} - ${t.label} : ${t.getSettings().channelCount} channel(s)`)
      })
      stream=s
    })
  }

  return (params) => {
    if (!stream) {
      getStream()
      return
    }
    let vca = envelope(params, 0.5, 'linpad')
    let track = evalMainParamEvent(params, 'track', undefined)
    fxMixChain(params, effects(params, perFrameAmp(params, vca)))
    let audioIn
    if (track !== undefined) {
      let mediaTrack = stream.getTracks()[track]
      if (mediaTrack === undefined) {
        consoleOut(`Track ${track} is not valid for this device`)
        return
      }
      audioIn = system.audio.createMediaStreamTrackSource(mediaTrack)
    } else {
      audioIn = system.audio.createMediaStreamSource(stream)
    }
    waveEffects(params, audioIn).connect(vca)
    params._destructor.disconnect(vca, audioIn)
  }
})
