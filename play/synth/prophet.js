'use strict';
define(function (require) {
  if (!window.AudioWorkletNode) { return ()=>{} }

  let system = require('play/system')
  require('play/pwm')
  let scale = require('music/scale')
  let envelope = require('play/envelopes')
  let effects = require('play/effects')
  let pitchEffects = require('play/pitch-effects')
  let waveEffects = require('play/wave-effects')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  return (params) => {
    let degree = parseInt(params.sound) + evalPerEvent(params, 'add', 0)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, evalPerEvent(params, 'oct', 3), evalPerEvent(params, 'scale'), evalPerEvent(params, 'sharp', 0))
    let detuneSemis = evalPerEvent(params, 'detune', 0.1)
    let lfo = evalPerEvent(params, 'lfo', 1/4)

    let vca = envelope(params, 0.04, 'full')
    system.mix(effects(params, vca))

    let lfoOsc = system.audio.createOscillator()
    lfoOsc.type = 'triangle'
    lfoOsc.frequency.value = lfo / params.beat.duration
    let lfoGain = system.audio.createGain()
    lfoGain.gain.value = 0.49
    lfoOsc.connect(lfoGain)
    lfoOsc.start(params.time)
    lfoOsc.stop(params.endTime)

    let lpf = system.audio.createBiquadFilter()
    lpf.type = 'lowpass'
    lpf.frequency.setValueAtTime(6000, params.time)
    lpf.frequency.linearRampToValueAtTime(freq*2, params.endTime)
    lpf.Q.value = 0.4
    lpf.connect(vca)

    let pitch = pitchEffects(params)
    let vcos = [0, 0.1]
    let multiosc = system.audio.createGain()
    multiosc.gain.value = 1/vcos.length
    waveEffects(params, multiosc).connect(lpf)

    vcos.map(detune => {
      let vco = new AudioWorkletNode(system.audio, "pwm-oscillator")
      vco.parameters.get('frequency').value = freq * Math.pow(2, detune * detuneSemis/12)
      lfoGain.connect(vco.parameters.get('pulseWidth'))
      pitch.connect(vco.parameters.get('detune'))
      vco.connect(multiosc)
      vco.parameters.get('start').setValueAtTime(1, params.time)
      vco.parameters.get('stop').setValueAtTime(0, system.audio.currentTime)
      vco.parameters.get('stop').setValueAtTime(1, params.endTime)
      return vco
    })
    system.disconnect(params, vcos.concat(vca,lfoOsc,lfoGain,lpf,multiosc))
  }
});
