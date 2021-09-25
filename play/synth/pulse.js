'use strict';
define(function (require) {
  if (!window.AudioWorkletNode) { return ()=>{} }

  let system = require('play/system')
  let scale = require('music/scale')
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let pitchEffects = require('play/effects/pitch-effects')
  let waveEffects = require('play/effects/wave-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  let wave
  let pulseWaveFft = () => {
    if (!wave) {
      // From: https://github.com/chipbell4/nes-sequencer/blob/master/src/oscillators.js
      let pulseWidth = 0.03
      let real = [0]
      let imag = [0]
      for (let i = 1; i < 2048; i++) {
        let realTerm = 4 / (i * Math.PI) * Math.sin(Math.PI * i * pulseWidth)
        real.push(realTerm)
        imag.push(0)
      }
      wave = system.audio.createPeriodicWave(new Float32Array(real), new Float32Array(imag))
    }
    return wave
  }

  return (params) => {
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 3), evalPerEvent(params, 'scale'), evalPerEvent(params, 'sharp', 0))
    let detuneSemis = evalPerEvent(params, 'detune', 0)

    let vca = envelope(params, 0.06, 'full')
    let out = effects(params, vca)
    system.mix(out)

    let pitch = pitchEffects(params)
    let vco = system.audio.createOscillator()
    vco.setPeriodicWave(pulseWaveFft())
    vco.frequency.value = freq * Math.pow(2, detuneSemis/12)
    pitch.connect(vco.detune)

    waveEffects(params, vco).connect(vca)
    vco.start(params._time)
    vco.stop(params.endTime)
    system.disconnect(params, [vco,vca])
  }
});
