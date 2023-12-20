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
      s.getAudioTracks().forEach((t,i) => {
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
    let audioIn
    if (track !== undefined) {
      let mediaTrack = stream.getAudioTracks()[track]
      if (mediaTrack === undefined) {
        consoleOut(`Track ${track} is not valid for this device`)
        return
      }
      audioIn = system.audio.createMediaStreamTrackSource(mediaTrack)
    } else {
      audioIn = system.audio.createMediaStreamSource(stream)
    }
    let channel = evalMainParamEvent(params, 'channel', undefined)
    let signal = audioIn
    if (channel !== undefined) {
      let splitter = system.audio.createChannelSplitter()
      audioIn.connect(splitter)
      signal = system.audio.createGain(1)
      signal.channelCountMode = "explicit"
      signal.channelCount = 1
      splitter.connect(signal, channel) // Select one channel only if channel param is specified
      params._destructor.disconnect(splitter, signal)
    }
    fxMixChain(params, perFrameAmp(params, vca))
    waveEffects(params, effects(params, signal)).connect(vca)
    params._destructor.disconnect(vca, audioIn)
  }
})
