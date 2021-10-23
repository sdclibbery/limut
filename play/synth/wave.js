'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let pitchEffects = require('play/effects/pitch-effects')
  let waveEffects = require('play/effects/wave-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')
  let pulse = require('play/synth/waveforms/pulse')

  let setWave = (osc, wave) => {
    if (wave === 'pulse') { osc.setPeriodicWave(pulse()) }
    else { osc.type = wave }
  }

  return (params) => {
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 4), evalPerEvent(params, 'scale'), evalPerEvent(params, 'sharp', 0))
    let detuneSemis = evalPerEvent(params, 'detune', 0)
    let wave = evalPerEvent(params, "wave", "sawtooth")

    let vca = envelope(params, 0.06, 'full')
    let out = effects(params, vca)
    system.mix(out)

    let pitch = pitchEffects(params)
    let vco = system.audio.createOscillator()
    setWave(vco, wave)
    vco.frequency.value = freq * Math.pow(2, detuneSemis/12)
    pitch.connect(vco.detune)
    
    waveEffects(params, vco).connect(vca)
    vco.start(params._time)
    vco.stop(params.endTime)
    system.disconnect(params, [vca,vco])
  }
});
