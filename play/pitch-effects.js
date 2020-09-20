'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalPerEvent,evalPerFrame} = require('play/eval-audio-params')

  return (params) => {
    let vib = evalPerEvent(params, 'vib', 0)
    if (!vib) { return {connect:()=>{}} }
    let vibdepth = evalPerEvent(params, 'vibdepth', 0.4)
    let vibdelay = evalPerEvent(params, 'vibdelay', 1)
    let lfo = system.audio.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = vib / params.beat.duration
    let vca = system.audio.createGain()
    vca.gain.setValueAtTime(0, params.time)
    vca.gain.linearRampToValueAtTime(vibdepth*100, params.time + vibdelay*params.beat.duration)
    lfo.connect(vca)
    lfo.start(params.time)
    lfo.stop(params.endTime)
    system.disconnect(params, [lfo,vca])
    return vca
  }

})