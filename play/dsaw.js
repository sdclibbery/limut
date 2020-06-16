define(function (require) {
  let play = require('play/play');
  let scale = require('music/scale');

  let dsaw = {};

  dsaw.play = (sound, beatDuration, time, params) => {
    let degree = parseInt(sound)
    if (isNaN(degree)) { return }
    let dur = Math.max(0.01, (eval(params.sus) || eval(params.dur) || 0.25) * beatDuration)
    let attack = eval(params.attack || 0.1) * beatDuration
    let decay = eval(params.decay || 0.2) * beatDuration
    let gain = Math.max(0.0001, 0.2 * (eval(params.amp) || 1))
    let freq = scale.degreeToFreq(degree, eval(params.oct) || 4)
    let detuneSemis = eval(params.detune) || 0.2

    let vco1 = play.audio.createOscillator();
    vco1.type = 'sawtooth';
    vco1.frequency.value = freq
    let vco2 = play.audio.createOscillator();
    vco2.type = 'sawtooth';
    vco2.frequency.value = freq
    vco2.detune.value = detuneSemis*100
    let vca = play.audio.createGain();

    vco1.connect(vca);
    vco2.connect(vca);
    play.mix(vca);

    vco1.start(time);
    vco2.start(time);
    vca.gain.cancelScheduledValues(time)
    vca.gain.setValueAtTime(0, time)

    vca.gain.linearRampToValueAtTime(gain, time + attack);
    vca.gain.linearRampToValueAtTime(gain, time + dur);
    vca.gain.linearRampToValueAtTime(0.0001, time + dur + decay);

    vco1.stop(time + dur + decay);
    vco2.stop(time + dur + decay);
  }

  return dsaw;
});
