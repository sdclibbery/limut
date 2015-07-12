// Adapter for percussion audio

define(function (require) {
var play = require('play/play');

var percussion = {};

percussion.hat = function (time) {
  playNoise(0.03, 0.07, 2048, 0.3, time);
};

percussion.snare = function (time) {
  playNoise(0.02, 0.3, 2048, 0.5, time);
};

percussion.kick = function (time) {
  playNoise(0.02, 0.11, 128, 1.0, time);
};

var playNoise = function (attack, decay, fftSize, gain, time) {
  var duration = attack + decay;
  var vca = play.audio.createGain();
  play.mix(vca);
  vca.gain.value = 0.0;
  var vco = play.audio.createOscillator();
  vco.setPeriodicWave(createNoiseTable(fftSize));
  vco.frequency.value = 1/duration;
  vco.connect(vca);
  vco.start(time);
  vca.gain.linearRampToValueAtTime(gain, time + attack);
  vca.gain.exponentialRampToValueAtTime(0.001, time + duration);
  vco.stop(time + duration);
};

var createNoiseTable = function (size) {
  var real = [0];
  var imag = [0];
  for (var i = 1; i < size; i++){
    real[i] = (Math.random())*2 - 1;
    imag[i] = (Math.random())*2 - 1;
  }
  return play.audio.createPeriodicWave(new Float32Array(real), new Float32Array(imag));
};

return percussion;
});
