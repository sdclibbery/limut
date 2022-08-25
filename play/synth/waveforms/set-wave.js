'use strict';
define(function (require) {
  let pulse = require('play/synth/waveforms/pulse')
  let system = require('play/system')

  let nullWave
  let nullPeriodicWave = () => {
    if (!nullWave) {
      let real = [0,0]
      let imag = [0,0]
      nullWave = system.audio.createPeriodicWave(new Float32Array(real), new Float32Array(imag))
    }
    return nullWave
  }

  let baseUrl = 'play/synth/waveforms/wave-tables/'
  let waveTables = {}
  let getPeriodicWave = (wave) => {
    let waveTable = waveTables[wave]
    if (waveTable === undefined) {
      waveTable = {}
      waveTables[wave] = waveTable
      let request = new XMLHttpRequest()
      request.open('GET', baseUrl+wave, true)
      request.responseType = 'text'
      request.onload = () => {
        let data = eval('(' + request.response + ')')
        waveTable.periodicWave = system.audio.createPeriodicWave(new Float32Array(data.real), new Float32Array(data.imag))
      }
      request.onerror = console.log
      request.send()
      waveTable.periodicWave = nullPeriodicWave()
    }
    return waveTable.periodicWave
  }

  return (osc, wave) => {
    wave = wave.toLowerCase()
    if (wave === 'pulse') { osc.setPeriodicWave(pulse()) }
    else if ({'sine':1,'square':1,'sawtooth':1,'triangle':1}[wave]) { osc.type = wave }
    else { osc.setPeriodicWave(getPeriodicWave(wave)) }
  }
});
