define(function (require) {

var play = {
  audio: new AudioContext(),
};

play.resume = () => play.audio.resume()

play.vcaMainAmp = play.audio.createGain()
play.vcaMainAmp.gain.value = 1
play.mainAmp = (amp) => {
  if (typeof amp == 'number') {
    play.vcaMainAmp.gain.value = amp
  }
  return play.vcaMainAmp.gain.value
}

play.timeNow = function () {
  return play.audio.currentTime;
};

play.mix = function (node) {
  node.connect(play.vcaMainAmp);
};

var _initReverb = function () {
  play.reverb = play.audio.createConvolver();
  var seconds = 1;
  var decay = 5;
  var rate = play.audio.sampleRate;
  var length = rate * seconds;
  var impulse = play.audio.createBuffer(2, length, rate);
  var impulseL = impulse.getChannelData(0);
  var impulseR = impulse.getChannelData(1);
  for (var i = 0; i < length; i++) {
    impulseL[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    impulseR[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  play.reverb.buffer = impulse;
};
_initReverb();
play.compressor = play.audio.createDynamicsCompressor()
play.reverb.connect(play.compressor);
play.vcaMainAmp.connect(play.reverb)
play.vcaMainAmp.connect(play.compressor)
play.compressor.connect(play.audio.destination)

var _getFft = function (data) {
  if (!ffts[data]) {
    ffts[data] = play.audio.createPeriodicWave(new Float32Array(data.real), new Float32Array(data.imag));
  }
  return ffts[data];
};

return play;
});
