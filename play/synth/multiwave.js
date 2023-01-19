'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let pitchEffects = require('play/effects/pitch-effects')
  let waveEffects = require('play/effects/wave-effects')
  let {evalMainParamEvent,evalSubParamFrame} = require('play/eval-audio-params')
  let setWave = require('play/synth/waveforms/set-wave')

  let createWave = (params, id, freq) => {
    let wave = evalMainParamEvent(params, id)
    if (!wave) { return undefined }
    // vco
    let vco = system.audio.createOscillator()
    setWave(vco, wave)
    evalSubParamFrame(vco.frequency, params, id, 'detune', 0, (d) => freq * Math.pow(2, d/12))
    pitchEffects(vco.detune, params)
    vco.start(params._time)
    vco.stop(params.endTime)
    // vca
    if (typeof params[id] === 'object' && (params[id].amp === undefined || params[id].amp === 1)) {
      return vco // No need for vca if amp is constant 1
    }
    let vca = system.audio.createGain()
    evalSubParamFrame(vca.gain, params, id, 'amp', 1)
    vco.connect(vca)
    return vca
  }

  return (params) => {
    let freq = scale.paramsToFreq(params, 4)
    if (isNaN(freq)) { return }

    let vca = envelope(params, 0.03, 'full')
    let out = effects(params, vca)
    system.mix(out)

    let vcos
    if (Array.isArray(params.waves)) {
      params.waves.count = params.count // A bit icky but needed by the param eval
      params.waves._time = params._time
      params.waves.endTime = params.endTime
      vcos = params.waves.map((w, idx) => {
        return createWave(params.waves, idx, freq) // Again, a bit icky so that the param eval can pretend its a normal params object and not an array
      })
    } else if (!!params.waves) { // Used the waves param, but only used a single one
      vcos = [createWave(params, 'waves', freq)]
    } else {
      vcos = [1,2,3,4,5,6,7].map(idx => {
        return createWave(params, 'wave'+idx, freq)
      })
    }
    vcos = vcos.filter(o => !!o)
    // console.log(vcos.length, params.waves) // Use to the length to prove that the array is coming through as a non-chord array

    let multiosc = system.audio.createGain()
    multiosc.gain.value = Math.pow(1/Math.max(vcos.length,1), 1/4)
    vcos.forEach(vco => vco.connect(multiosc))
    waveEffects(params, multiosc).connect(vca)
    system.disconnect(params, vcos.concat(vca,multiosc))
  }
});
