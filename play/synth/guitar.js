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

  // Release and dead note noises are from a different guitar (Karoryfer Shinyguitar)
  let noiseTakes = 5
  let noiseUrl = (name, rr) => 'sample/guitar/noise/'+name+'r'+rr+'.mp3'
  let releases = { Cs2:37, E2:40, Fs2:42, A2:45, C3:48, Ds3:51, Fs3:54, A3:57, C4:60,
    Ds4:63, Fs4:66, A4:69, C5:72, Ds5:75, Fs5:78, A5:81, C6:84 }
  let openStrings = [40, 45, 50, 55, 59, 64] // dead1 is the low E string
  let releaseGain = 0.32 // ~10dB under the note, as Shinyguitar mixes them
  let releaseDecay = 7 // dB quieter per second the note was held
  let noiseTail = 0.5 // Longest noise sample, s; keeps the voice alive past the note's release

  let nearestRelease = (midi) => Object.keys(releases)
    .reduce((a, b) => Math.abs(releases[a] - midi) <= Math.abs(releases[b] - midi) ? a : b)
  let stringFor = (midi) => openStrings.reduce((s, open, i) => midi >= open ? i+1 : s, 1)

  let nearestSample = (freq) => {
    let best, diff = Infinity
    Object.keys(samples).forEach(s => {
      let d = Math.abs(Math.log(freq / samples[s].freq))
      if (d < diff) { best = s; diff = d }
    })
    return best
  }

  let rrCounters = {}
  let nextRoundRobin = (key, takes) => {
    let rr = rrCounters[key] || 0
    rrCounters[key] = rr + 1
    return (rr % takes) + 1
  }

  // Cycles through the takes, skipping any still loading; undefined if none has loaded yet
  let loadedTake = (key, takes, urlFor) => {
    for (let i = 1; i <= takes; i++) { getBuffer(urlFor(i)) }
    let rr = nextRoundRobin(key, takes)
    for (let i = 0; i < takes; i++) {
      let r = ((rr - 1 + i) % takes) + 1
      if (isLoaded(urlFor(r))) { return r }
    }
  }

  // Prefer another take of the right sample over a different pitch while the right one loads
  let chooseLoaded = (sample, layer) => {
    let rr = loadedTake(sample+'v'+layer, roundRobins, r => urlOf(sample, layer, r))
    if (rr) { return {sample, layer, rr} }
    let layerFor = (s) => (layer === 1 && samples[s].soft) ? 1 : 2
    let distance = (s) => Math.abs(samples[s].midi - samples[sample].midi)
    let loaded = Object.keys(samples)
      .filter(s => isLoaded(urlOf(s, layerFor(s), 1)))
      .sort((a, b) => distance(a) - distance(b))[0]
    if (loaded) { return {sample:loaded, layer:layerFor(loaded), rr:1} }
    return {sample, layer, rr:1}
  }

  let releaseNoise = (params, midi, freq, out) => {
    let level = evalMainParamEvent(params, 'fretnoise', 1)
    if (!level) { return }
    let name = 'rel'+nearestRelease(midi)
    for (let i = 1; i <= noiseTakes; i++) { getBuffer(noiseUrl(name, i)) }
    let play = () => {
      let rr = loadedTake(name, noiseTakes, r => noiseUrl(name, r))
      if (!rr) { return }
      let time = params._releaseTime !== undefined ? params._releaseTime : params.endTime
      let held = Math.max(0, time - params._time)
      let amp = typeof params.amp === 'number' ? params.amp : 1
      let source = system.audio.createBufferSource()
      source.buffer = getBuffer(noiseUrl(name, rr))
      source.playbackRate.value = freq / midiToFreq(releases[nearestRelease(midi)])
      let vca = system.audio.createGain()
      vca.gain.value = level * amp * 0.09 * releaseGain * Math.pow(10, -(releaseDecay*held + 3*Math.random())/20)
      source.connect(vca)
      vca.connect(out)
      source.start(time)
      params._destructor.disconnect(vca, source)
      params._destructor.stop(source)
    }
    let noteOff = params._noteOff
    if (!noteOff) { play(); return }
    let released = false
    params._noteOff = () => { // Live note: the release time is only known at note off
      noteOff()
      if (!released) { released = true; play() }
    }
  }

  let play = (params) => {
    let freq = scale.paramsToFreq(params, 3)
    if (isNaN(freq)) { return }
    let midi = 69 + 12*Math.log2(freq/440)
    let dead = evalMainParamEvent(params, 'dead', 0)
    let source = system.audio.createBufferSource()
    let gain = 0.09
    if (dead) {
      let string = 'dead'+stringFor(midi)
      source.buffer = getBuffer(noiseUrl(string, loadedTake(string, noiseTakes, r => noiseUrl(string, r)) || 1))
    } else {
      let vel = evalMainParamEvent(params, 'vel', 3/4)
      let nearest = nearestSample(freq)
      let {sample, layer, rr} = chooseLoaded(nearest, layerOf(nearest, vel))
      source.buffer = getBuffer(urlOf(sample, layer, rr))
      source.playbackRate.value = freq / samples[sample].freq
      if (layer === 1) { gain *= softGain }
      params._tail = noiseTail
    }

    let vca = envelope(params, gain, 'organ')
    let out = system.audio.createGain()
    waveEffects(params, effects(params, source)).connect(vca)
    vca.connect(out)
    fxMixChain(params, perFrameAmp(params, out))
    pitchEffects(source.detune, params)

    source.start(params._time)
    params._destructor.disconnect(vca, source, out)
    params._destructor.stop(source)
    if (!dead) { releaseNoise(params, midi, freq, out) }
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
    let takes = [1,2,3,4,5].map(() => nextRoundRobin('X', 4))
    assert('1,2,3,4,1', takes.join(','), 'round robins cycle')
    assert(1, stringFor(35), 'below the low E is the low E string')
    assert(1, stringFor(44), 'up to the A string is the low E string')
    assert(2, stringFor(45), 'open A')
    assert(6, stringFor(90), 'high notes are on the high E string')
    assert('C3', nearestRelease(48), 'release noise exact')
    assert('Cs2', nearestRelease(30), 'release noise clamps low')
    assert('C6', nearestRelease(100), 'release noise clamps high')
    rrCounters = {}
    console.log('Guitar tests complete')
  }

  return play
});
