'use strict';
define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let pitchEffects = require('play/effects/pitch-effects')
  let waveEffects = require('play/effects/wave-effects')
  let {evalMainParamNow} = require('play/eval-audio-params')
  let setWave = require('play/synth/waveforms/set-wave')

  let lfos
  let createLfo = (freq, semis) => {
      let lfo = system.audio.createOscillator()
      lfo.type = 'triangle'
      lfo.frequency.value = freq
      lfo.start()
      lfo._semis = semis
      return lfo
  }
  let getLfos = () => {
    if (lfos) { return lfos }
    lfos = [
      createLfo(1/3, 1/2),
      createLfo(1/11, 1),
      createLfo(1/19, 1),
      createLfo(1/29, 1)
    ]
    return lfos
  }

  return (params) => {
    let freq = scale.paramsToFreq(params, 4)
    if (isNaN(freq)) { return }
    let detuneSemis = evalMainParamNow(params, 'detune', 1/3)
    let wave = evalMainParamNow(params, "wave", "sine")

    let vca = envelope(params, 0.06, 'pad')
    let out = effects(params, vca)
    system.mix(out)

    let pitch = pitchEffects(params)
    let lfoVcas = []
    let vcos = getLfos().map(lfo => {
      let vco = system.audio.createOscillator()
      setWave(vco, wave)
      vco.frequency.value = freq
      // LFO wobble
      let vca = system.audio.createGain()
      vca.gain.value = freq * (1 - Math.pow(2, detuneSemis*lfo._semis/12))
      lfo.connect(vca)
      vca.connect(vco.frequency)
      lfoVcas.push(vca)
      pitch.connect(vco.detune)
      return vco
    })
    
    let multiosc = system.audio.createGain()
    multiosc.gain.value = 1/vcos.length
    waveEffects(params, multiosc).connect(vca)
    vcos.forEach(vco => vco.connect(multiosc))
    vcos.forEach(vco => vco.start(params._time))
    vcos.forEach(vco => vco.stop(params.endTime))
    system.disconnect(params, vcos.concat(vca,multiosc,lfoVcas))
  }
});
