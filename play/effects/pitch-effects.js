'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalMainParamEvent,evalSubParamEvent,evalMainParamFrame} = require('play/eval-audio-params')

  return (params) => {
    let vcaVib
    let vcaAddc
    if (params.vib !== undefined) {
      let vib = evalMainParamEvent(params, 'vib', 0)
      let vibdepth = evalSubParamEvent(params, 'vib', 'depth', 0.4)
      let vibdelay = evalSubParamEvent(params, 'vib', 'delay', 1/2)
      let lfo = system.audio.createOscillator()
      lfo.type = 'sine'
      lfo.frequency.value = vib / params.beat.duration
      vcaVib = system.audio.createGain()
      vcaVib.gain.setValueAtTime(0.001, params._time)
      vcaVib.gain.exponentialRampToValueAtTime(vibdepth*100, params._time + vibdelay*params.beat.duration)
      lfo.connect(vcaVib)
      lfo.start(params._time)
      lfo.stop(params.endTime)
      system.disconnect(params, [lfo,vcaVib])
    }
    if (params.addc !== undefined) {
      let cents = system.audio.createConstantSource()
      cents.offset.value = 100
      vcaAddc = system.audio.createGain()
      evalMainParamFrame(vcaAddc.gain, params, 'addc', 0)
      cents.connect(vcaAddc)
      cents.start()
      cents.stop(params.endTime)
      system.disconnect(params, [cents, vcaAddc])
    }
    if (vcaVib && vcaAddc) {
      let vca = system.audio.createGain()
      vcaVib.connect(vca)
      vcaAddc.connect(vca)
      system.disconnect(params, [vca])
      return vca
    }
    return vcaVib || vcaAddc || {connect:()=>{}} 
  }

})