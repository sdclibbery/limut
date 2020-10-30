'use strict';
define(function (require) {
  let system = require('play/system')
  let param = require('player/default-param')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')
  let freeverb = require('play/freeverb')

  let echoes = {}
  let echo = (params, node) => {
    let echoDelay = evalPerEvent(params, 'echo', 0) * params.beat.duration
    if (!echoDelay || echoDelay < 0.0001) { return node }
    let echoFeedback = Math.min(evalPerEvent(params, 'echogain', 0.5), 0.9)
    let key = echoDelay + 'f' + echoFeedback
    if (!echoes[key]) {
      echoes[key] = system.audio.createDelay(echoDelay)
      echoes[key].delayTime.value = echoDelay
      let echoGain = system.audio.createGain()
      echoGain.gain.value = echoFeedback
      echoes[key].connect(echoGain)
      echoGain.connect(echoes[key])
      system.mix(echoGain)
    }
    node.connect(echoes[key])
    return node
  }

  let reverbs = {}
  let reverb = (params, node) => {
    let room = evalPerEvent(params, 'room', 0)*0.7
    if (!room || room < 0.01) { return node }
    if (!reverbs[room]) {
      reverbs[room] = freeverb(room)
    }
    node.connect(reverbs[room])
    return node
  }

  let perFrameAmp = (params, node) => {
    if (typeof params.amp !== 'function') { return node } // No per frame control required
    let vca = system.audio.createGain()
    evalPerFrame(vca.gain, params, 'amp', 1)
    node.connect(vca)
    system.disconnect(params, [vca,node])
    return vca
  }

  let lpf = (params, node) => {
    if (!param(params.lpf, 0)) { return node }
    let lpf = system.audio.createBiquadFilter()
    lpf.type = 'lowpass'
    evalPerFrame(lpf.frequency, params, 'lpf')
    evalPerFrame(lpf.Q, params, 'lpr', 5)
    node.connect(lpf)
    system.disconnect(params, [lpf,node])
    return lpf
  }

  let hpf = (params, node) => {
    if (!param(params.hpf, 0)) { return node }
    let hpf = system.audio.createBiquadFilter()
    hpf.type = 'highpass'
    evalPerFrame(hpf.frequency, params, 'hpf')
    evalPerFrame(hpf.Q, params, 'hpr', 5)
    node.connect(hpf)
    system.disconnect(params, [hpf,node])
    return hpf
  }

  let bpf = (params, node) => {
    if (!param(params.bpf, 0)) { return node }
    let bpf = system.audio.createBiquadFilter()
    bpf.type = 'bandpass'
    evalPerFrame(bpf.frequency, params, 'bpf')
    evalPerFrame(bpf.Q, params, 'bpr', 5)
    node.connect(bpf)
    system.disconnect(params, [bpf,node])
    return bpf
  }

  let chop = (params, node) => {
    let chops = evalPerEvent(params, 'chop', 0)
    if (!chops) { return node }
    let lfo = system.audio.createOscillator()
    lfo.type = 'square';
    lfo.frequency.value = chops / params.beat.duration
    let gain = system.audio.createGain()
    gain.gain.setValueAtTime(1, params.time)
    lfo.connect(gain.gain)
    lfo.start(params.time)
    lfo.stop(params.endTime)
    node.connect(gain)
    system.disconnect(params, [gain,lfo,node])
    return gain
  }

  let drive = (params, node) => {
    let amount = evalPerEvent(params, 'drive', 0)
    if (!amount) { return node }
    let shaper = system.audio.createWaveShaper()
    let count = 500
    let driveCurve = new Float32Array(2*count+1)
    driveCurve[count] = 0
    for (let i = 1; i < count+1; i++) {
      let x = i/count
      let y
      if (i%3 == 0) { y = x }
      if (i%3 == 1) { y = x-amount*x }
      if (i%3 == 2) { y = x-amount*x/2 }
      driveCurve[count-i] = -y
      driveCurve[count+i] = y
    }
    shaper.curve = driveCurve
    shaper.oversample = 'none'
    node.connect(shaper)
    system.disconnect(params, [shaper,node])
    return shaper
  }

  let phaser = (params, node) => {
    let lfoFreq = evalPerEvent(params, 'phaser', 0)
    if (lfoFreq == 0) { return node }

    let lfo = system.audio.createOscillator()
    lfo.frequency.value = lfoFreq / params.beat.duration
    lfo.start(params.time)
    lfo.stop(params.endTime)

    let lfoGain = system.audio.createGain()
    lfoGain.gain.value = 1200
    lfo.connect(lfoGain)

    let mix = system.audio.createGain()
    mix.gain.value = 1/2
    node.connect(mix)

    let aps = []
    let makeAllPass = (freq) => {
      let ap = system.audio.createBiquadFilter()
      ap.type='allpass'
      ap.Q.value = 0.125
      ap.frequency.value = freq
      lfoGain.connect(ap.detune)
      aps.push(ap)
      return ap
    }

    node
      .connect(makeAllPass(100))
      .connect(makeAllPass(200))
      .connect(makeAllPass(400))
      .connect(makeAllPass(800))
      .connect(mix)
    system.disconnect(params, aps.concat([node,lfo,mix,lfoGain]))
    return mix
  }

  return (params, node) => {
    node = perFrameAmp(params, node)
    node = chop(params, node)
    node = drive(params, node)
    node = lpf(params, node)
    node = hpf(params, node)
    node = bpf(params, node)
    node = phaser(params, node)
    node = reverb(params, node)
    node = echo(params, node)
    return node
  }
})
