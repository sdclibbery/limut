'use strict';
define(function (require) {
  if (!window.AudioWorkletNode) { return ()=>{} }

  let system = require('play/system')
  require('play/pwm-source')
  let scale = require('music/scale')
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let {fxMixChain} = require('play/effects/fxMixChain')
  let pitchEffects = require('play/effects/pitch-effects')
  let waveEffects = require('play/effects/wave-effects')
  let {evalMainParamEvent,evalMainParamFrame} = require('play/eval-audio-params')
  let perFrameAmp = require('play/effects/perFrameAmp')

  return (params) => {
    let freq = scale.paramsToFreq(params, 3)
    if (isNaN(freq)) { return }
    let detuneSemis = evalMainParamEvent(params, 'detune', 0.1)

    let vca = envelope(params, 0.02, 'full')
    fxMixChain(params, perFrameAmp(params, vca))

    let vco = new AudioWorkletNode(system.audio, "pwm-oscillator")
    vco.parameters.get('frequency').value = freq * Math.pow(2, detuneSemis/12)
    evalMainParamFrame(vco.parameters.get('pulseWidth'), params, "pwm", 1/2, undefined, x=>Math.max(Math.min(x,1),0))
    pitchEffects(vco.parameters.get('detune'), params)
    vco.parameters.get('start').setValueAtTime(1, params._time)
    vco.parameters.get('stop').setValueAtTime(0, system.audio.currentTime)
    vco.parameters.get('stop').setValueAtTime(1, params.endTime)
    waveEffects(params, effects(params, vco)).connect(vca)

    params._destructor.disconnect(vca, vco)
  }
});
