'use strict';
define(function (require) {
  let system = require('play/system');
  let destructor = require('play/destructor')
  let effects = require('play/effects/effects')
  let {fxMixChain} = require('play/effects/fxMixChain')
  let waveEffects = require('play/effects/wave-effects')
  let whiteNoise = require('play/synth/waveforms/noise').white
  let setWave = require('play/synth/waveforms/set-wave')
  let {getBuffer,getUrl} = require('play/samples')
  let {evalMainParamEvent,evalSubParamEvent} = require('play/eval-audio-params')
  let perFrameAmp = require('play/effects/perFrameAmp')
  let timeToTime = require('units').timeToTime

  let clickBuffer
  let clickTime = 0.001
  let getClick = () => {
    if (clickBuffer === undefined) {
      const sampleRate = system.audio.sampleRate
      clickBuffer = system.audio.createBuffer(1, clickTime*sampleRate, sampleRate);
      let clickData = clickBuffer.getChannelData(0)
      for (var i = 0; i < clickData.length; i++) {
        clickData[i] = 1
      }
    }
    return clickBuffer
  }
  let click = (params) => {
    let gain = evalMainParamEvent(params, 'click', 1)*0.07
    if (gain <= 0.0001) { return undefined }
    let click = system.audio.createBufferSource()
    params._destructor.disconnect(click)
    click.buffer = getClick()
    click.start(params._time)
    click.stop(params._time + click.buffer.duration)
    params.endTime = Math.max(params.endTime, params._time+click.buffer.duration)
    let vca = system.audio.createGain()
    params._destructor.disconnect(vca)
    vca.gain.value = gain
    click.connect(vca)
    return vca
  }

  let hit = (params) => {
    let gain = evalMainParamEvent(params, 'hit', 0)*0.25
    if (gain <= 0.0001) { return undefined }
    let sample = evalSubParamEvent(params, 'hit', 'sample', '^')
    let sampleIdx = evalSubParamEvent(params, 'hit', 'index', 1)
    let rate = evalSubParamEvent(params, 'hit', 'rate', 3/2)
    let source = system.audio.createBufferSource()
    source.buffer = getBuffer(getUrl(sample, sampleIdx))
    if (!source.buffer) { return undefined }
    params._destructor.disconnect(source)
    source.playbackRate.value = rate
    let vca = system.audio.createGain()
    params._destructor.disconnect(vca)
    vca.gain.value = gain
    source.connect(vca)
    source.start(params._time)
    params._destructor.stop(source)
    params.endTime = Math.max(params.endTime, params._time+source.buffer.duration)
    return vca
  }

  let tanhCurveData
  let tanhCurve = () => {
    if (!!tanhCurveData) { return tanhCurveData }
    var N = 255
    tanhCurveData = new Float32Array(N)
    for (var i = 0; i < tanhCurveData.length; i++) {
        var x = 2 * (i / (N - 1)) - 1
        tanhCurveData[i] = Math.tanh(x*2)
    }
    return tanhCurveData
  }
  let body = (params, p, def) => {
    let gain = evalMainParamEvent(params, p, def)*0.2
    if (gain <= 0.0001) { return undefined }
    let units = evalSubParamEvent(params, p, 'units', 'ms').toLowerCase()
    let timeScale = timeToTime(1, units, params)
    let attack = evalSubParamEvent(params, p, 'att', 10)*timeScale
    let decay = evalSubParamEvent(params, p, 'dec', 800)*timeScale
    let freq = evalSubParamEvent(params, p, 'freq', 55)
    let boost = evalSubParamEvent(params, p, 'boost', 150)
    let pitchatt = evalSubParamEvent(params, p, 'pitchatt', 0)*timeScale
    let pitchdec = evalSubParamEvent(params, p, 'pitchdec', 100)*timeScale
    let wave = evalSubParamEvent(params, p, 'wave', 'sine')
    let saturation = evalSubParamEvent(params, p, 'saturation', 0)
    let vco = system.audio.createOscillator()
    params._destructor.disconnect(vco)
    setWave(vco, wave)
    vco.frequency.setValueAtTime(0,0)
    vco.frequency.setValueAtTime(0, params._time)
    vco.frequency.linearRampToValueAtTime(freq+boost, params._time + pitchatt)
    vco.frequency.exponentialRampToValueAtTime(freq, params._time + pitchatt+pitchdec)
    let vca = system.audio.createGain()
    params._destructor.disconnect(vca)
    vca.gain.setValueAtTime(0,0)
    vca.gain.setValueAtTime(0, params._time)
    vca.gain.linearRampToValueAtTime(gain, params._time+attack)
    vca.gain.exponentialRampToValueAtTime(0.00001, params._time + attack+decay)
    if (!!saturation) {
      let satGain = system.audio.createGain()
      satGain.gain.value = saturation
      let ws = system.audio.createWaveShaper()
      ws.curve = tanhCurve()
      ws.oversample = '2x'
      vco.connect(satGain)
      satGain.connect(ws)
      ws.connect(vca)
      params._destructor.disconnect(satGain, ws)
    } else {
      vco.connect(vca)
    }
    vco.start(params._time)
    params._destructor.stop(vco)
    params.endTime = Math.max(params.endTime, params._time+attack+decay)
    return vca
  }

  let rattle = (params) => {
    let gain = evalMainParamEvent(params, 'rattle', 1)*0.4
    if (gain <= 0.0001) { return undefined }
    let units = evalSubParamEvent(params, 'rattle', 'units', 'ms').toLowerCase()
    let timeScale = timeToTime(1, units, params)
    let attack = evalSubParamEvent(params, 'rattle', 'att', 2)*timeScale
    let decay = evalSubParamEvent(params, 'rattle', 'dec', 60)*timeScale
    let rate = evalSubParamEvent(params, 'rattle', 'rate', 1)
    let freq = evalSubParamEvent(params, 'rattle', 'freq', 55)
    let boost = evalSubParamEvent(params, 'rattle', 'boost', 205)
    let pitchatt = evalSubParamEvent(params, 'rattle', 'pitchatt', 2)*timeScale
    let pitchdec = evalSubParamEvent(params, 'rattle', 'pitchdec', 100)*timeScale
    let filter = evalSubParamEvent(params, 'rattle', 'filter', 'lowpass')
    let q = evalSubParamEvent(params, 'rattle', 'q', 18)
    let n = whiteNoise()
    params._destructor.disconnect(n)
    n.playbackRate.value = rate
    let lpf = system.audio.createBiquadFilter()
    params._destructor.disconnect(lpf)
    lpf.type = filter
    lpf.Q.value = q
    lpf.frequency.setValueAtTime(10,0)
    lpf.frequency.setValueAtTime(10, params._time)
    lpf.frequency.linearRampToValueAtTime(freq+boost, params._time + pitchatt)
    lpf.frequency.exponentialRampToValueAtTime(freq, params._time + pitchatt+pitchdec)
    n.connect(lpf)
    let vca = system.audio.createGain()
    params._destructor.disconnect(vca)
    vca.gain.setValueAtTime(0,0)
    vca.gain.setValueAtTime(0, params._time)
    vca.gain.linearRampToValueAtTime(gain, params._time+attack)
    vca.gain.exponentialRampToValueAtTime(0.00001, params._time + attack+decay)
    lpf.connect(vca)
    n.start(params._time)
    params._destructor.stop(n)
    params.endTime = Math.max(params.endTime, params._time+attack+decay)
    return vca
  }

  return (params) => {
    let vca = system.audio.createGain()
    let gainbase = 0.5 * evalMainParamEvent(params, "loud", 1)
    vca.gain.value = Math.max(0, gainbase * (typeof params.amp === 'number' ? params.amp : 1))

    params._destructor = destructor()
    params.endTime = params._time
    let components = [
      click(params),
      hit(params),
      body(params, 'body', 1),
      body(params, 'body2', 0),
      rattle(params),
    ]
    let mix = system.audio.createGain()
    components
      .filter(c => c !== undefined)
      .forEach(c => c.connect(mix))
    setTimeout(() => params._destructor.destroy(), 100+(params.endTime - system.audio.currentTime)*1000)
    fxMixChain(params, perFrameAmp(params, vca))
    waveEffects(params, effects(params, mix)).connect(vca)
    params._destructor.disconnect(vca, mix)
  }
});
