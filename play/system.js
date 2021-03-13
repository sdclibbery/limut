'use strict';
define(function (require) {
let {move, filterInPlace} = require('array-in-place')


var system = {
  queued: [],
  active: [],
}

system.add = (startTime, update) => {
  system.queued.push({t:startTime, update:update})
}

let state = {}
system.frame = (time, count) => {
  move(system.queued, system.active, ({t}) => time > t)
  state.count = count
  state.time = time
  filterInPlace(system.active, ({update}) => update(state))
}

system.resume = () => {} // Resume WebAudio

const startTime = performance.now()
system.timeNow = function () {
  return (performance.now() - startTime)/1000
}

system.latency = () => {
  return 0 // ??? 
}

system.mainAmp = (amp) => {
  if (typeof amp == 'number') {
    system.mainAmpValue = amp
    // ???
  }
  return system.mainAmpValue
}
system.mainAmpUi = (amp) => {
  if (typeof amp == 'number') {
    system.mainAmpUiValue = amp
    // ???
  }
  return system.mainAmpUiValue
}

system.compressorReduction = () => {
  if (!system.compressor) { return 0 }
  // ???
}

system.spectrum = () => {
    // ???
    return [0,0,0,0]
}
system.scope = () => {
  let data = new Float32Array(system.analyser.fftSize)
  // ???
  return data
}

system.mix = function (node) {
    // ???
  }

system.disconnect = (params, nodes) => {
  setTimeout(() => {
    // ???
  }, 100+(params.endTime - system.audio.currentTime)*1000)
}

system.disconnectAt = (time, nodes) => {
  setTimeout(() => {
    // ???
  }, 100+(time - system.audio.currentTime)*1000)
}

system.mainReverb = (reverb) => {
  if (typeof reverb == 'number') {
    // ???
  }
  return 0//system.vcaReverb.gain.value
}

return system;
});
