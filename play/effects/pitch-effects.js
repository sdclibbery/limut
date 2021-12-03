'use strict';
define(function (require) {
  let system = require('play/system')
  let {evalMainParamNow,evalMainParamFrame} = require('play/eval-audio-params')

  return (params) => {
    let vcaVib
    let vcaAddc
    if (params.vib !== undefined) {
      let vib = evalMainParamNow(params, 'vib', 0)
      let vibdepth = evalMainParamNow(params, 'vibdepth', 0.4)
      let vibdelay = evalMainParamNow(params, 'vibdelay', 1)
      let lfo = system.audio.createOscillator()
      lfo.type = 'sine'
      lfo.frequency.value = vib / params.beat.duration
      vcaVib = system.audio.createGain()
      vcaVib.gain.setValueAtTime(0, params._time)
      vcaVib.gain.linearRampToValueAtTime(vibdepth*100, params._time + vibdelay*params.beat.duration)
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