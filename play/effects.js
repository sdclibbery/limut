define(function (require) {
  let system = require('play/system')
  let param = require('player/default-param')



  let echoes = {}
  let echo = (params, node) => {
    let echoDelay = param(params.echo, 0) * params.beat.duration
    if (echoDelay && echoDelay > 0.0001) {
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
    } else {
      return node
    }
  };

  return (params, node) => {
    node = echo(params, node)
    return node
  }
})
