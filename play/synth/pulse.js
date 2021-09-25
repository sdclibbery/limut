'use strict';
define(function (require) {
  if (!window.AudioWorkletNode) { return ()=>{} }

  let system = require('play/system')
  require('play/pwm')
  let scale = require('music/scale')
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let pitchEffects = require('play/effects/pitch-effects')
  let waveEffects = require('play/effects/wave-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  return (params) => {
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 3), evalPerEvent(params, 'scale'), evalPerEvent(params, 'sharp', 0))
    let detuneSemis = evalPerEvent(params, 'detune', 0)

    let vca = envelope(params, 0.05, 'full')
    let out = effects(params, vca)
    system.mix(out)

    let pitch = pitchEffects(params)
    let vco = new AudioWorkletNode(system.audio, "pwm-oscillator")
    vco.parameters.get('pulseWidth').value = 0.03
    vco.parameters.get('frequency').value = freq * Math.pow(2, detuneSemis/12)
    pitch.connect(vco.parameters.get('detune'))

    waveEffects(params, vco).connect(vca)
    vco.parameters.get('start').setValueAtTime(1, params._time)
    vco.parameters.get('stop').setValueAtTime(0, system.audio.currentTime)
    vco.parameters.get('stop').setValueAtTime(1, params.endTime)
    system.disconnect(params, [vco,vca])
  }
});
