// Adapter for percussion audio

define(function (require) {
var play = require('play/play');

var percussion = {};

percussion.closedhat = function (time) {
  playCymbal(0.1, 0.7, time);
};

percussion.openhat = function (time) {
  playCymbal(1, 0.4, time);
};

percussion.snare = function (time) {
  playNoise(0.02, 0.3, 2048, 0.7, time);
};

percussion.kick = function (time) {
  playNoise(0.02, 0.11, 128, 1.0, time);
};

var playCymbal = function (decay, gain, time) {
  var attack = 0;
  var duration = attack + decay;

  var vca = play.audio.createGain();
  vca.gain.value = 0;

  var vco = play.audio.createOscillator();
  vco.type = 'square';
  vco.frequency.value = 2490;

  var lfo = play.audio.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 1047;

  var lfoGain = play.audio.createGain();
  lfoGain.gain.value = vco.frequency.value*10;

  lfo.connect(lfoGain);
  lfoGain.connect(vco.frequency);
  vco.connect(vca);
  play.mix(vca);

  vco.start(time);
  lfo.start(time);
  vca.gain.linearRampToValueAtTime(gain, time + attack);
  vca.gain.exponentialRampToValueAtTime(0.001, time + duration);
  vco.stop(time + duration);
  lfo.stop(time + duration);
}

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
