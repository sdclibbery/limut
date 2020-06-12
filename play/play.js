define(function (require) {
var piano = 'play/piano';
var celeste = 'play/celeste';

var ffts = {};

var play = {
  audio: new AudioContext(),
};

play.resume = () => play.audio.resume()

play.timeNow = function () {
  return play.audio.currentTime;
};

var fadeInOut = [0, 0.309, 0.588, 0.809, 0.951, 1, 0.951, 0.809, 0.588, 0.309, 0];
play.chorus = function (time, freq, duration) {
  var vca = play.audio.createGain();
  play.mix(vca);
  vca.gain.value = 0.0;
  fadeInOut.map(function (g,i,a) {
    var f = i / a.length;
    vca.gain.linearRampToValueAtTime(0.08*g, time + f*duration*2);
  });
  var vco = play.audio.createOscillator();
  vco.frequency.value = freq;
  vco.setPeriodicWave(_getFft(celeste));
  vco.connect(vca);
  vco.start(time);
  vco.stop(time + duration*2);
};


play.lead = function (time, freq, duration) {
  var vca = play.audio.createGain();
  play.mix(vca);
  vca.gain.value = 0.0;
  var vco = play.audio.createOscillator();
  vco.frequency.value = freq;
  vco.setPeriodicWave(_getFft(piano));
  vco.connect(vca);
  vco.start(time);
  vca.gain.linearRampToValueAtTime(0.6, time + 0.05);
  vca.gain.linearRampToValueAtTime(0.001, time + duration);
  vco.stop(time + duration);
};

play.mix = function (node) {
  node.connect(play.reverb);
  node.connect(play.audio.destination);
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
  play.reverb.connect(play.audio.destination);
};
_initReverb();

var _getFft = function (data) {
  if (!ffts[data]) {
    ffts[data] = play.audio.createPeriodicWave(new Float32Array(data.real), new Float32Array(data.imag));
  }
  return ffts[data];
};

return play;
});
