'use strict';
define(function (require) {
let {move, filterInPlace} = require('array-in-place')

var webAudio = window.AudioContext || window.webkitAudioContext
var system = {
  audio: new webAudio(),
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

system.resume = () => system.audio.resume()

system.timeNow = function () {
  return system.audio.currentTime;
}

system.latency = () => {
  return system.audio.outputLatency 
}

system.vcaMainAmp = system.audio.createGain()
system.vcaMainAmp.gain.value = 1
system.mainAmpUiValue = 1
system.mainAmpUi = (amp) => {
  if (typeof amp === 'number') {
    system.mainAmpUiValue = amp
    system.vcaMainAmp.gain.value = Math.pow(system.mainAmpUiValue, 2)
  }
  return system.mainAmpUiValue
}

system.analyser = system.audio.createAnalyser()
system.analyser.fftSize = 2048
system.analyser.smoothingTimeConstant = 0.6
let analyserBufferLength = system.analyser.frequencyBinCount
const spectrumData = new Uint8Array(analyserBufferLength)
let chunk = (data, reducer, init) => {
  return data.reduce((a,b) => reducer(a,b), init) / 255
}
const spec = []
system.spectrum = () => {
  system.analyser.getByteFrequencyData(spectrumData)
  spec[0] = chunk(spectrumData.slice(0,4), Math.min, 1e6)
  spec[1] = chunk(spectrumData.slice(4,8), Math.min, 1e6)
  spec[2] = chunk(spectrumData.slice(8,12), (a,b)=>a+b, 0)/4
  spec[3] = chunk(spectrumData.slice(12), Math.max,0)
  return spec
}
const scopeData = new Float32Array(system.analyser.fftSize)
system.scope = () => {
  system.analyser.getFloatTimeDomainData(scopeData)
  return scopeData
}
const fftData = new Float32Array(system.analyser.frequencyBinCount)
system.fft = () => {
  system.analyser.getFloatFrequencyData(fftData)
  return fftData
}
const meterData = new Float32Array(system.analyser.fftSize)
system.meter = () => {
  system.analyser.getFloatTimeDomainData(meterData)
  let peakInstantaneousPower = 0
  for (let i = 0; i < system.analyser.fftSize; i++) {
    const power = meterData[i] ** 2
    peakInstantaneousPower = Math.max(power, peakInstantaneousPower)
  }
  const peakInstantaneousPowerDecibels = 10 * Math.log10(peakInstantaneousPower)
  return peakInstantaneousPowerDecibels
}

system.mix = function (node) {
  node.connect(system.vcaMainAmp)
}

system.disconnect = (params, nodes) => {
  setTimeout(() => {
    nodes.forEach(n => n.disconnect())
  }, 100+(params.endTime - system.audio.currentTime)*1000)
}

system.disconnectAt = (time, nodes) => {
  setTimeout(() => {
    nodes.forEach(n => n.disconnect())
  }, 100+(time - system.audio.currentTime)*1000)
}

system.limiter = system.audio.createDynamicsCompressor()
system.limiter.ratio.value = 20
system.limiter.threshold.value = -1
system.limiter.release.value = 0.05
system.limiter.attack.value = 0.001
system.limiter.knee.value = 0
system.limiterReduction = () => {
  if (!system.limiter) { return 0 }
  return system.limiter.reduction
}

system.vcaMainAmp.connect(system.limiter)
system.limiter.connect(system.analyser)
system.analyser.connect(system.audio.destination)

return system
})
