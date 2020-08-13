'use strict';
define(function (require) {
  let system = require('play/system')
  let param = require('player/default-param')
  let freeverb = require('play/freeverb')

  let echoes = {}
  let echo = (params, node) => {
    let echoDelay = param(params.echo, 0) * params.beat.duration
    if (!echoDelay || echoDelay < 0.0001) { return node }
    if (!echoes[echoDelay]) {
      echoes[echoDelay] = system.audio.createDelay(echoDelay)
      echoes[echoDelay].delayTime.value = echoDelay
      let echoGain = system.audio.createGain()
      echoGain.gain.value = 1/2
      echoes[echoDelay].connect(echoGain)
      echoGain.connect(echoes[echoDelay])
      system.mix(echoGain)
    }
    node.connect(echoes[echoDelay])
    return node
  }

  let reverbs = {}
  let reverb = (params, node) => {
    let room = param(params.room, 0)*0.7
    if (!room || room < 0.01) { return node }
    if (!reverbs[room]) {
      reverbs[room] = freeverb(room)
    }
    node.connect(reverbs[room])
    return node
  }

  let lpf = (params, node) => {
    let cutoff = param(params.lpf, 0)
    if (!cutoff) { return node }
    let lpf = system.audio.createBiquadFilter()
    lpf.type = 'lowpass'
    lpf.frequency.value = cutoff
    lpf.Q.value = Math.min(param(params.lpr, 1), 10)
    node.connect(lpf)
    return lpf
  }

  let hpf = (params, node) => {
    let cutoff = param(params.hpf, 0)
    if (!cutoff) { return node }
    let hpf = system.audio.createBiquadFilter()
    hpf.type = 'highpass'
    hpf.frequency.value = cutoff
    hpf.Q.value = Math.min(param(params.hpr, 1), 10)
    node.connect(hpf)
    return hpf
  }

  let bpf = (params, node) => {
    let cutoff = param(params.bpf, 0)
    if (!cutoff) { return node }
    let bpf = system.audio.createBiquadFilter()
    bpf.type = 'bandpass'
    bpf.frequency.value = cutoff
    bpf.Q.value = Math.min(param(params.bpr, 1), 10)
    node.connect(bpf)
    return bpf
  }

  let chop = (params, node) => {
    let chops = param(params.chop, 0)
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
    system.disconnect(params, [gain,lfo])
    return gain
  }

  let drive = (params, node) => {
    let amount = param(params.drive, 0)
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
    return shaper
  }

  let phaser = (params, node) => {
    let lfoPeriod = param(params.phaser, 0)
    if (lfoPeriod == 0) { return node }

    let lfo = system.audio.createOscillator()
    lfo.frequency.value = 1 / (params.beat.duration * lfoPeriod)
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
