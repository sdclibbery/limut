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

let globalBaseGain = 2
system.vcaMainAmp = system.audio.createGain()
system.vcaMainAmp.gain.value = globalBaseGain
system.mainAmpValue = 1
system.mainAmpUiValue = 1
system.mainAmp = (amp) => {
  if (typeof amp == 'number') {
    system.mainAmpValue = amp
    system.vcaMainAmp.gain.value = Math.pow(system.mainAmpUiValue, 2)*system.mainAmpValue*globalBaseGain
  }
  return system.mainAmpValue
}
system.mainAmpUi = (amp) => {
  if (typeof amp == 'number') {
    system.mainAmpUiValue = amp
    system.vcaMainAmp.gain.value = Math.pow(system.mainAmpUiValue, 2)*system.mainAmpValue*globalBaseGain
  }
  return system.mainAmpUiValue
}
system.vcaPreAmp = system.audio.createGain()
system.vcaPreAmp.gain.value = 0.5

system.compressorReduction = () => {
  if (!system.compressor) { return 0 }
  return system.compressor.reduction
}

system.analyser = system.audio.createAnalyser()
system.analyser.fftSize = 1024
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
  node.connect(system.vcaPreAmp)
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

var _initReverb = function () {
  system.reverb = system.audio.createConvolver();
  var seconds = 0.5;
  var decay = 5;
  var rate = system.audio.sampleRate;
  var length = rate * seconds;
  var impulse = system.audio.createBuffer(2, length, rate);
  var impulseL = impulse.getChannelData(0);
  var impulseR = impulse.getChannelData(1);
  for (var i = 0; i < length; i++) {
    impulseL[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    impulseR[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  system.reverb.buffer = impulse;
};
_initReverb();
system.mainReverb = (reverb) => {
  if (typeof reverb == 'number') {
    system.vcaReverb.gain.value = reverb
  }
  return system.vcaReverb.gain.value
}
system.vcaReverb = system.audio.createGain()
system.vcaReverb.gain.value = 1
system.reverb.connect(system.vcaReverb)

system.compressor = system.audio.createDynamicsCompressor()
system.compressor.ratio.value = 20
system.compressor.threshold.value = -2
system.compressor.release.value = 0.05
system.compressor.attack.value = 0.001
system.compressor.knee.value = 0

system.vcaPreAmp.connect(system.compressor)
system.vcaPreAmp.connect(system.reverb)
system.vcaReverb.connect(system.compressor)
system.compressor.connect(system.vcaMainAmp)
system.vcaMainAmp.connect(system.analyser)
system.vcaMainAmp.connect(system.audio.destination)

return system;
});
