'use strict';
define(function (require) {
  let system = require('play/system')
  let param = require('player/default-param')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')
  let freeverb = require('play/freeverb')

  let echoes = {}
  let echo = (params, node) => {
    let echoDelay = evalPerEvent(params, 'echo', 0)
    if (!echoDelay || echoDelay < 0.0001) { return node }
    let echoFeedback = Math.min(evalPerEvent(params, 'echofeedback', 0.5), 0.95)
    let quantisedEcho = (Math.round(echoDelay*16)/16) * params.beat.duration
    let quantisedEchoFeedback = Math.round(echoFeedback*20)/20
    let key = quantisedEcho + 'f' + quantisedEchoFeedback
    if (!echoes[key]) {
      echoes[key] = system.audio.createDelay(quantisedEcho)
      echoes[key].delayTime.value = quantisedEcho
      let echoGain = system.audio.createGain()
      echoGain.gain.value = quantisedEchoFeedback
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
    let quantisedRoom = Math.round(room*20)/20
    if (!reverbs[quantisedRoom]) {
      reverbs[quantisedRoom] = freeverb(quantisedRoom)
    }
    node.connect(reverbs[quantisedRoom])
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

  const synthDefLpf = Uint8Array.from(
    // SynthDef("lpf", {|bus=10,freq=440,q=10|
    //   ReplaceOut.ar(bus, RLPF.ar(In.ar(bus, 2), freq, 1/q));
    // }).add.asBytes.postcs();
    [ 83, 67, 103, 102, 0, 0, 0, 2, 0, 1, 3, 108, 112, 102, 0, 0, 0, 1, 63, -128, 0, 0, 0, 0, 0, 3, 65, 32, 0, 0, 67, -36, 0, 0, 65, 32, 0, 0, 0, 0, 0, 3, 3, 98, 117, 115, 0, 0, 0, 0, 4, 102, 114, 101, 113, 0, 0, 0, 1, 1, 113, 0, 0, 0, 2, 0, 0, 0, 6, 7, 67, 111, 110, 116, 114, 111, 108, 1, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 1, 1, 1, 2, 73, 110, 2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 12, 66, 105, 110, 97, 114, 121, 79, 112, 85, 71, 101, 110, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 4, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 4, 82, 76, 80, 70, 2, 0, 0, 0, 3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 2, 4, 82, 76, 80, 70, 2, 0, 0, 0, 3, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 2, 10, 82, 101, 112, 108, 97, 99, 101, 79, 117, 116, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0 ]
  )
  let lpf = (params, node) => {
    if (!param(params.lpf, 0)) { return node }
    system.sc.addSynthDef(synthDefLpf)
    let lpf = system.sc.nextNode()
    system.sc.bundle.push(system.sc.oscMsg('/s_new', 'siiisisfsf', 'lpf', lpf, 3, node,
    'bus', system.sc.bus, 'freq', evalPerEvent(params, 'lpf', 500), 'q', evalPerEvent(params, 'lpr', 10)
    ))
    // evalPerFrame(lpf.frequency, params, 'lpf')
    // evalPerFrame(lpf.Q, params, 'lpr', 10)
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

  let pan = (params, node) => {
    if (!param(params.pan, 0)) { return node }
    let pan = system.audio.createStereoPanner()
    evalPerFrame(pan.pan, params, 'pan')
    node.connect(pan)
    system.disconnect(params, [pan,node])
    return pan
  }

  return (params, node) => {
    node = perFrameAmp(params, node)
    node = chop(params, node)
    node = drive(params, node)
    node = lpf(params, node)
    node = hpf(params, node)
    node = bpf(params, node)
    node = phaser(params, node)
    node = pan(params, node)
    node = reverb(params, node)
    node = echo(params, node)
    return node
  }
})
