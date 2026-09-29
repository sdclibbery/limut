'use strict';
define(function (require) {
  let system = require('play/system');
  let {getBuffer, isLoaded} = require('play/samples')
  let effects = require('play/effects/effects')
  let {fxMixChain} = require('play/effects/fxMixChain')
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let scale = require('music/scale');
  let waveEffects = require('play/effects/wave-effects')
  let envelope = require('play/envelopes')
  let pitchEffects = require('play/effects/pitch-effects')
  let perFrameAmp = require('play/effects/perFrameAmp')

  let midiToFreq = (n) => 440 * Math.pow(2, (n-69)/12)
  // soft: has a soft velocity layer. Every sample is peak normalised, which leaves the soft
  // layer ~3dB louder than the hard one, hence softGain.
  let samples = {
    C2: {midi:36, soft:true}, E2: {midi:40, soft:true}, F2: {midi:41, soft:true},
    A2: {midi:45, soft:true}, C3: {midi:48, soft:true}, D3: {midi:50, soft:true},
    E3: {midi:52, soft:true}, G3: {midi:55, soft:true}, B3: {midi:59, soft:true},
    Cs4: {midi:61, soft:true}, E4: {midi:64, soft:true},
    G4: {midi:67}, B4: {midi:71}, C5: {midi:72}, D5: {midi:74}, F5: {midi:77},
    Gs5: {midi:80}, As5: {midi:82}, Cs6: {midi:85},
  }
  Object.values(samples).forEach(s => s.freq = midiToFreq(s.midi))
  let roundRobins = 4
  let softVel = 92/127
  let softGain = 0.7

  let layerOf = (sample, vel) => (vel < softVel && samples[sample].soft) ? 1 : 2
  let urlOf = (sample, layer, rr) => 'sample/guitar/'+sample+'v'+layer+'r'+rr+'.mp3'

  let nearestSample = (freq) => {
    let best, diff = Infinity
    Object.keys(samples).forEach(s => {
      let d = Math.abs(Math.log(freq / samples[s].freq))
      if (d < diff) { best = s; diff = d }
    })
    return best
  }

  let rrCounters = {}
  let nextRoundRobin = (key) => {
    let rr = rrCounters[key] || 0
    rrCounters[key] = rr + 1
    return (rr % roundRobins) + 1
  }

  // Prefer another take of the right sample over a different pitch while the right one loads
  let chooseLoaded = (sample, layer) => {
    let key = sample+'v'+layer
    let rr = nextRoundRobin(key)
    for (let i = 1; i <= roundRobins; i++) { getBuffer(urlOf(sample, layer, i)) }
    for (let i = 0; i < roundRobins; i++) {
      let r = ((rr - 1 + i) % roundRobins) + 1
      if (isLoaded(urlOf(sample, layer, r))) { return {sample, layer, rr:r} }
    }
    let layerFor = (s) => (layer === 1 && samples[s].soft) ? 1 : 2
    let distance = (s) => Math.abs(samples[s].midi - samples[sample].midi)
    let loaded = Object.keys(samples)
      .filter(s => isLoaded(urlOf(s, layerFor(s), 1)))
      .sort((a, b) => distance(a) - distance(b))[0]
    if (loaded) { return {sample:loaded, layer:layerFor(loaded), rr:1} }
    return {sample, layer, rr}
  }

  let play = (params) => {
    let freq = scale.paramsToFreq(params, 3)
    if (isNaN(freq)) { return }
    let vel = evalMainParamEvent(params, 'vel', 3/4)
    let nearest = nearestSample(freq)
    let {sample, layer, rr} = chooseLoaded(nearest, layerOf(nearest, vel))

    let source = system.audio.createBufferSource()
    source.buffer = getBuffer(urlOf(sample, layer, rr))
    source.playbackRate.value = freq / samples[sample].freq

    let vca = envelope(params, 0.09 * (layer === 1 ? softGain : 1), 'organ')
    waveEffects(params, effects(params, source)).connect(vca)
    fxMixChain(params, perFrameAmp(params, vca))
    pitchEffects(source.detune, params)

    source.start(params._time)
    params._destructor.disconnect(vca, source)
    params._destructor.stop(source)
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual, msg) => {
      if (expected !== actual) { console.trace(`Assertion failed ${msg||''}.\n>>Expected: ${expected}\n>>Actual:   ${actual}`) }
    }
    assert('C2', nearestSample(midiToFreq(36)), 'exact match')
    assert('C2', nearestSample(20), 'below the range clamps to the lowest sample')
    assert('Cs6', nearestSample(5000), 'above the range clamps to the highest sample')
    assert('E2', nearestSample(midiToFreq(39)), 'nearest in semitones')
    assert(1, layerOf('C3', 0.5), 'soft layer below threshold')
    assert(2, layerOf('C3', 0.75), 'hard layer at default vel')
    assert(2, layerOf('G4', 0.1), 'no soft layer above E4')
    rrCounters = {}
    let takes = [1,2,3,4,5].map(() => nextRoundRobin('X'))
    assert('1,2,3,4,1', takes.join(','), 'round robins cycle')
    rrCounters = {}
    console.log('Guitar tests complete')
  }

  return play
});
