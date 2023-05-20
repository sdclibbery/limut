'use strict';
define(function (require) {
  let system = require('play/system')
  let {mainParam} = require('player/sub-param')
  let {evalMainParamFrame,evalSubParamFrame} = require('play/eval-audio-params')
  let {findNonChordParams} = require('player/non-chord-params')

  let resonant = (params, node, type, freqParam, defaultResonance) => {
    if (!mainParam(params[freqParam], 0)) { return node }
    let filter = system.audio.createBiquadFilter()
    filter.type = type
    evalMainParamFrame(filter.frequency, params, freqParam)
    evalSubParamFrame(filter.Q, params, freqParam, 'q', defaultResonance)
    node.connect(filter)
    params._destructor.disconnect(filter, node)
    return filter
  }

  let eq = (params, node, type, gainParam, defaultFreq, defaultQ) => {
    if (!mainParam(params[gainParam], 0)) { return node }
    let filter = system.audio.createBiquadFilter()
    filter.type = type
    evalMainParamFrame(filter.gain, params, gainParam, undefined, x => Math.log10(Math.max(x,1e-6))*20) // Convert to dB for WebAudio
    evalSubParamFrame(filter.frequency, params, gainParam, 'freq', defaultFreq)
    evalSubParamFrame(filter.Q, params, gainParam, 'q', defaultQ)
    node.connect(filter)
    params._destructor.disconnect(filter, node)
    return filter
  }

  let psf = (params, p, n, f, defaultFreq) => {
    let filter = system.audio.createBiquadFilter()
    filter.type = 'allpass'
    evalSubParamFrame(filter.frequency, params, p, f, defaultFreq)
    evalSubParamFrame(filter.Q, params, p, 'q', 1)
    n.connect(filter)
    params._destructor.disconnect(filter, n)
    return filter
  }
  let phaserStageFilter = (params, p, node) => { // Two allpass in parallel
    if (params[p] === undefined) { return node }
    let output = system.audio.createGain()
    output.gain.value = 1/2
    params._destructor.disconnect(output)
    psf(params, p, node, 'f1', 200).connect(output)
    psf(params, p, node, 'f2', 800).connect(output)
    return output
  }

  let parallel = (params, node, p, creator) => {
    let ps = findNonChordParams(params, p)
    if (ps.length == 0) { return node }
    let output = system.audio.createGain()
    output.gain.value = 1/ps.length
    params._destructor.disconnect(output)
    ps.map(p => creator(p, node)).forEach(f => f.connect(output))
    return output
  }

  let series = (params, node, p, creator) => {
    let ps = findNonChordParams(params, p)
    if (ps.length == 0) { return node }
    ps.forEach(p => {
      node = creator(p, node)
    })
    return node
  }

  return (params, node) => {
    node = resonant(params, node, 'lowpass', 'lpf', 5)
    node = resonant(params, node, 'highpass', 'hpf', 5)
    node = resonant(params, node, 'bandpass', 'bpf', 1)
    node = resonant(params, node, 'notch', 'nf', 1)
    node = parallel(params, node, 'apf', (p,n) => resonant(params, n, 'allpass', p, 1))
    node = phaserStageFilter(params, 'psf', node) // Can have a single unnumbered psf if desired
    node = series(params, node, 'psf', (p,n) => phaserStageFilter(params, p, n))
    node = eq(params, node, 'lowshelf', 'low', 200, 0)
    node = eq(params, node, 'highshelf', 'high', 1100, 0)
    node = eq(params, node, 'peaking', 'mid', 600, 5)
    return node
  }
})
