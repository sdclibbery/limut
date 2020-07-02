define(function (require) {
  let system = require('play/system')
  let param = require('player/default-param')

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
  };

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

  let chop = (params, node) => {
    let chops = param(params.chop, 0)
    if (!chops) { return node }
    lfo = system.audio.createOscillator()
    lfo.type = 'square';
    lfo.frequency.value = chops / params.beat.duration
    let gain = system.audio.createGain()
    gain.gain.setValueAtTime(1, params.time)
    lfo.connect(gain.gain)
    lfo.start(params.time)
    lfo.stop(params.endTime)
    node.connect(gain)
    return gain
  }

  return (params, node) => {
    node = chop(params, node)
    node = lpf(params, node)
    node = hpf(params, node)
    node = echo(params, node)
    return node
  }
})
