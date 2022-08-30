'use strict';
define(function (require) {
  let system = require('play/system');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let waveEffects = require('play/effects/wave-effects')
  let whiteNoise = require('play/synth/waveforms/noise').white
  let setWave = require('play/synth/waveforms/set-wave')
  let {evalMainParamEvent,evalSubParamEvent} = require('play/eval-audio-params')

  let clickBuffer
  let getClick = () => {
    if (clickBuffer === undefined) {
      const sampleRate = system.audio.sampleRate
      clickBuffer = system.audio.createBuffer(1, 0.001*sampleRate, sampleRate);
      let clickData = clickBuffer.getChannelData(0)
      for (var i = 0; i < clickData.length; i++) {
        clickData[i] = 1
      }
    }
    return clickBuffer
  }
  let click = (params, nodes) => {
    let gain = evalMainParamEvent(params, 'click', 1)*0.8
    if (gain <= 0.0001) { return }
    let click = system.audio.createBufferSource()
    click.buffer = getClick()
    click.start(params._time)
    click.stop(params._time + 0.01)
    let vca = system.audio.createGain()
    vca.gain.value = gain
    click.connect(vca)
    return vca
  }

  let curve = (init, final, power) => {
    const steps = 9
    const data = new Float32Array(steps)
    for (let i=0; i<steps; i++) {
      let lerp = Math.pow(i/(steps-1), 1/power)
      data[i] = init*(1-lerp) + final*lerp
    }
    return data
  }

  let body = (params, nodes) => {
    let gain = evalMainParamEvent(params, 'body', 1)*1.5
    if (gain <= 0.0001) { return }
    let freq = evalSubParamEvent(params, 'body', 'freq', 55)
    let boost = evalSubParamEvent(params, 'body', 'boost', 220)
    let pow = evalSubParamEvent(params, 'body', 'curve', 4)
    let wave = evalSubParamEvent(params, 'body', 'wave', 'sine')
    let vco = system.audio.createOscillator()
    nodes.push(vco)
    setWave(vco, wave)
    vco.frequency.cancelScheduledValues(0)
    vco.frequency.setValueAtTime(0, 0)
    vco.frequency.setValueCurveAtTime(curve(freq+boost, freq, pow), params._time, params.endTime-params._time)
    vco.start(params._time)
    vco.stop(params.endTime)
    let vca = system.audio.createGain()
    nodes.push(vca)
    vca.gain.value = gain
    vco.connect(vca)
    return vca
  }

  let rattle = (params, nodes) => {
    let gain = evalMainParamEvent(params, 'rattle', 1)*2
    if (gain <= 0.0001) { return }
    let freq = evalSubParamEvent(params, 'rattle', 'freq', 55)
    let boost = evalSubParamEvent(params, 'rattle', 'boost', 110)
    let pow = evalSubParamEvent(params, 'rattle', 'curve', 2)
    let q = evalSubParamEvent(params, 'rattle', 'q', 35)
    let n = whiteNoise()
    nodes.push(n)
    n.start(params._time)
    n.stop(params.endTime)
    let lpf = system.audio.createBiquadFilter()
    nodes.push(lpf)
    lpf.type = 'lowpass'
    lpf.Q.value = q
    lpf.frequency.cancelScheduledValues(0)
    lpf.frequency.setValueAtTime(0, 0)
    lpf.frequency.setValueCurveAtTime(curve(freq+boost, freq, pow), params._time, params.endTime-params._time)
    n.connect(lpf)
    let vca = system.audio.createGain()
    nodes.push(vca)
    vca.gain.value = gain
    lpf.connect(vca)
    return vca
  }

  return (params) => {
    let vca = envelope(params, 0.12, 'percussion')
    let out = effects(params, vca)
    system.mix(out)
    let mix = system.audio.createGain()

    let nodes = []
    let components = [
      click(params, nodes),
      body(params, nodes),
      rattle(params, nodes),
    ].filter(c => c !== undefined)
    components.map(c => c.connect(mix))

    waveEffects(params, mix).connect(vca)
    system.disconnect(params, nodes.concat([mix,vca]))
  }
});
