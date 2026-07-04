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
    // Stop the worklet via the destructor at the real destroy time rather than
    // scheduling it against endTime here: for live (keyboard/gamepad) notes
    // endTime is a _time+1e6 placeholder at build time, so a build-time stop
    // never fires and the worklet's process() runs forever after release,
    // leaking render capacity. The raw AudioWorkletNode has no stop() method, so
    // give it the same stop shim the superosc factory uses before registering it.
    vco.stop = (t = system.audio.currentTime) => vco.parameters.get('stop').setValueAtTime(1, t)
    waveEffects(params, effects(params, vco)).connect(vca)

    params._destructor.disconnect(vca, vco)
    params._destructor.stop(vco)
  }
});
