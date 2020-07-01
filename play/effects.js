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
    lpf.type = 'lpf'
    lpf.frequency.value = cutoff
    lpf.Q.value = Math.min(param(params.lpr, 1), 10)
    node.connect(lpf)
    return lpf
  }

  return (params, node) => {
    node = lpf(params, node)
    node = echo(params, node)
    return node
  }
})
