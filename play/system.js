'use strict';
define(function (require) {

var system = {
  audio: new AudioContext(),
};

system.resume = () => system.audio.resume()

system.timeNow = function () {
  return system.audio.currentTime;
};

let globalBaseGain = 0.5
system.vcaMainAmp = system.audio.createGain()
system.vcaMainAmp.gain.value = globalBaseGain
system.mainAmp = (amp) => {
  if (typeof amp == 'number') {
    system.vcaMainAmp.gain.value = amp*globalBaseGain
  }
  return system.vcaMainAmp.gain.value/globalBaseGain
}

system.compressorReduction = () => {
  if (!system.compressor) { return 0 }
  return system.compressor.reduction
}

system.mix = function (node) {
  node.connect(system.vcaMainAmp)
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
system.vcaReverb.connect(system.compressor)
system.vcaMainAmp.connect(system.reverb)
system.vcaMainAmp.connect(system.compressor)
system.compressor.connect(system.audio.destination)

return system;
});
