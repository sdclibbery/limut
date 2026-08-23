'use strict';
define(function (require) {
  if (!window.AudioWorkletNode) { return ()=>{} }

  let createPwm = require('play/pwm-source')
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

    let vco = createPwm()
    // Register the worklet with the destructor FIRST, before evaluating any params:
    // an AudioWorkletNode only terminates when its process() observes the stop param,
    // so anything throwing between here and the registration would leak a permanently
    // rendering worklet (main.js swallows the player error, so it would be silent and
    // invisible). Registering stops it at the real destroy time, which is also why it
    // is not scheduled against endTime here: for live (keyboard/gamepad) notes endTime
    // is a _time+1e6 placeholder at build time, so a build-time stop never fires.
    params._destructor.stop(vco)
    params._destructor.disconnect(vco)
    vco.parameters.get('frequency').value = freq * Math.pow(2, detuneSemis/12)
    evalMainParamFrame(vco.parameters.get('pulseWidth'), params, "pwm", 1/2, undefined, x=>Math.max(Math.min(x,1),0))
    pitchEffects(vco.parameters.get('detune'), params)
    waveEffects(params, effects(params, vco)).connect(vca)
    vco.start(params._time)
  }
});
