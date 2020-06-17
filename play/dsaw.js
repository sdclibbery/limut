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
    let detuneSemis = eval(params.detune) || 0.3

    let vcos = [0, 0.5, 0.7, 1].map(lerp => {
      vco = play.audio.createOscillator()
      vco.type = 'sawtooth';
      vco.frequency.value = freq
      vco.detune.value = lerp * detuneSemis*100
      return vco
    })
    let vca = play.audio.createGain();

    vcos.forEach(vco => vco.connect(vca))
    play.mix(vca);

    vcos.forEach(vco => vco.start(time))
    vca.gain.cancelScheduledValues(time)
    vca.gain.setValueAtTime(0, time)

    vca.gain.linearRampToValueAtTime(gain, time + attack);
    vca.gain.linearRampToValueAtTime(gain, time + dur);
    vca.gain.linearRampToValueAtTime(0.0001, time + dur + decay);

    vcos.forEach(vco => vco.stop(time + dur + decay))
  }

  return dsaw;
});
