'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalMainParamEvent,evalSubParamEvent,evalSubParamFrame} = require('play/eval-audio-params')
  let {mix} = require('play/effects/mix')

  let inputGain = (params, p, node) => {
    if (params[p].gain === undefined) { return node }
    let gain = system.audio.createGain()
    evalSubParamFrame(gain.gain, params, p, 'gain', 1)
    node.connect(gain)
    params._destructor.disconnect(gain)
    return gain
  }

  let toDb = x => Math.log10(Math.max(x,1e-6))*20 // limut gains are linear, WebAudio wants dB

  let compressor = (params, node) => {
    let compress = evalMainParamEvent(params, 'compress', 0)
    if (!compress) { return node }
    node = inputGain(params, 'compress', node)
    let compressor = system.audio.createDynamicsCompressor()
    compressor.ratio.value = compress
    compressor.threshold.value = toDb(evalSubParamEvent(params, 'compress', 'threshold', 1/316))
    compressor.knee.value = toDb(evalSubParamEvent(params, 'compress', 'knee', 100))
    compressor.attack.value = evalSubParamEvent(params, 'compress', 'att', 0.01, 's')
    compressor.release.value = evalSubParamEvent(params, 'compress', 'rel', 0.25, 's')
    node.connect(compressor)
    params._destructor.disconnect(compressor, node)
    return compressor
  }

  let shapeEffect = (params, effect, node, count, shape, oversample) => {
    let amount = evalMainParamEvent(params, effect, 0)
    if (!amount) { return node }
    node = inputGain(params, effect, node)
    let shaper = system.audio.createWaveShaper()
    let curve = new Float32Array(2*count+1)
    curve[count] = 0
    for (let i = 1; i < count+1; i++) {
      let x = i/count
      let y = shape(x, amount, i)
      curve[count-i] = -y
      curve[count+i] = y
    }
    shaper.curve = curve
    shaper.oversample = oversample || '2x'
    node.connect(shaper)
    params._destructor.disconnect(shaper, node)
    return mix(params, effect, node, shaper, 1)
  }

  let noisify = (x, amount, i) => {
    let y
    if (i%2 == 0) { y = x-amount*2*x }
    if (i%2 == 1) { y = x+amount*2*x }
    return y
  }

  let fold = (x, a) => {
    let sgn = Math.sign(x)
    let v = Math.abs(x)*(1+a)
    return sgn * (v>1 ? 1-(v-1) : v)
  }

  let clip = (x, a) => {
    let sgn = Math.sign(x)
    let v = Math.abs(x)*(1+a*40)
    return sgn * (v>1 ? 1 : v)
  }

  let drive = (x, a) => {
    a *= 100
    return (3 + a) * x * Math.PI * 0.333 / (Math.PI + a * Math.abs(x));
  }

  let waveEffects = (params, node) => {
    node = shapeEffect(params, 'noisify', node, 16383, noisify, '4x')
    node = shapeEffect(params, 'bits', node, 255, (x, b) => Math.pow(Math.round(Math.pow(x,1/2)*b)/b,2))
    node = shapeEffect(params, 'fold', node, 255, fold)
    node = shapeEffect(params, 'clip', node, 255, clip)
    node = shapeEffect(params, 'drive', node, 1023, drive)
    node = shapeEffect(params, 'suck', node, 255, (x, a) => Math.abs(x)<a ? x*Math.abs(x)/a : x)
    node = shapeEffect(params, 'linearshape', node, 7, (x) => x) // For testing purposes; applies clipping at -1 and 1, so can be used to test synth intermediate levels
    node = compressor(params, node)
    return node
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual, msg) => {
      if (Math.abs(expected - actual) > 0.01) { console.trace(`Assertion failed ${msg||''}.\n>>Expected: ${expected}\n>>Actual:   ${actual}`) }
    }
    let destructor = require('play/destructor')
    let compressed = (compress) => {
      let params = {compress:compress, _destructor:destructor(), _time:0, count:0}
      let node = compressor(params, system.audio.createGain())
      params._destructor.destroy()
      return node
    }
    let c = compressed(4)
    assert(4, c.ratio.value, 'ratio is a plain ratio')
    assert(-50, c.threshold.value, 'default threshold -50dB')
    assert(40, c.knee.value, 'default knee 40dB')
    c = compressed({value:2.5, threshold:Math.pow(10,-14/20), knee:Math.pow(10,12/20)})
    assert(-14, c.threshold.value, 'threshold written as -14dB')
    assert(12, c.knee.value, 'knee written as 12dB')
    console.log('Wave effects tests complete')
  }

  return waveEffects
})
