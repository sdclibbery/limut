define(function (require) {
  let system = require('play/system');
  let param = require('player/default-param')

  return (params, node) => {
    let lpf = system.audio.createBiquadFilter()
    lpf.type = 'lpf'
    lpf.Q.value = 20
    lpf.frequency.cancelScheduledValues(params.time)
    lpf.frequency.setValueAtTime(20000, params.time)
    lpf.frequency.linearRampToValueAtTime(200, params.endTime)
    node.connect(lpf)
    return lpf
  }
})
