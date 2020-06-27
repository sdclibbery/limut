define(function (require) {
var system = require('play/system');
let effects = require('play/effects')
let eval = require('player/eval-param')

var percussion = {};

percussion.play = (params) => {
  let amp = eval(params.amp, 1)
  switch (params.sound){
    case 'x': playNoise(0.11, 150, 10.0*amp, params.time, params); break;
    case 'X': playNoise(0.11, 150, 30.0*amp, params.time, params); break;
    case 'o': playNoise(0.3, 5000, 0.7*amp, params.time, params); break;
    case 'O': playNoise(0.3, 5000, 1.5*amp, params.time, params); break;
    case '-': playCymbal(0.3, 0.3*amp, params.time, params); break;
    case '+': playCymbal(0.3, 0.6*amp, params.time, params); break;
    case '=': playCymbal(1, 0.6*amp, params.time, params); break;
    case '#': playCymbal(1, 0.8*amp, params.time, params); break;
  }
}

var playCymbal = function (decay, gain, time, params) {
  var attack = 0;
  var duration = attack + decay;

  var vca = system.audio.createGain();
  vca.gain.value = 0;

  var vco = system.audio.createOscillator();
  vco.type = 'square';
  vco.frequency.value = 2490;

  var lfo = system.audio.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 1047;

  var lfoGain = system.audio.createGain();
  lfoGain.gain.value = vco.frequency.value*10;

  var hipass = system.audio.createBiquadFilter();
  hipass.type = 'highpass';
  hipass.frequency.value = 2640;
  hipass.frequency.linearRampToValueAtTime(8000, time+1);

  lfo.connect(lfoGain);
  lfoGain.connect(vco.frequency);
  vco.connect(hipass);
  hipass.connect(vca);
  system.mix(effects(params, vca))

  vco.start(time);
  lfo.start(time);
  vca.gain.cancelScheduledValues(time)
  vca.gain.setValueAtTime(0, time)
  vca.gain.linearRampToValueAtTime(gain, time + attack);
  vca.gain.exponentialRampToValueAtTime(0.001, time + duration);
  vco.stop(time + duration);
  lfo.stop(time + duration);
}

var noiseBuffer;
var playNoise = function (decay, cutoff, gain, time, params) {
  if (!noiseBuffer) {
    var bufferSize = 2 * system.audio.sampleRate;
    noiseBuffer = system.audio.createBuffer(1, bufferSize, system.audio.sampleRate);
    var output = noiseBuffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }
  }
  var attack = 0.02;
  var duration = attack + decay;
  var vca = system.audio.createGain();
  system.mix(effects(params, vca))
  vca.gain.value = 0.0;

  var whiteNoise = system.audio.createBufferSource();
  whiteNoise.buffer = noiseBuffer;
  whiteNoise.start(time);

  var lowpass = system.audio.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = cutoff;
  lowpass.frequency.linearRampToValueAtTime(cutoff/2, time+duration);
  whiteNoise.connect(lowpass);
  lowpass.connect(vca);

  vca.gain.cancelScheduledValues(time)
  vca.gain.setValueAtTime(0, time)
  vca.gain.linearRampToValueAtTime(gain, time + attack);
  vca.gain.exponentialRampToValueAtTime(0.001, time + duration);
  whiteNoise.stop(time + duration);
};

return percussion;
});
