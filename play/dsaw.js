define(function (require) {
  let play = require('play/play');
  let scale = require('music/scale');

  let dsaw = {};

  dsaw.play = (sound, time, params) => {
    let degree = parseInt(sound)
    if (isNaN(degree)) { return }
    let dur = Math.max(0.01, eval(params.dur) || 0.5)
    let attack = 0.1
    let decay = Math.max(0.01, dur - attack)
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
    vca.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    vco1.stop(time + dur);
    vco2.stop(time + dur);
  }

  return dsaw;
});
