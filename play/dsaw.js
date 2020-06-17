define(function (require) {
  let play = require('play/play');
  let scale = require('music/scale');

  let dsaw = {};

  let envelope = (params) => {
    let dur = Math.max(0.01, (eval(params.sus) || eval(params.dur) || 0.25) * params.beat.duration)
    let attack = eval(params.attack || 0.1) * params.beat.duration
    let decay = eval(params.decay || 0.2) * params.beat.duration
    let gain = Math.max(0.0001, 0.05 * (eval(params.amp) || 1))
    let vca = play.audio.createGain();
    vca.gain.cancelScheduledValues(params.time)
    vca.gain.setValueAtTime(0, params.time)
    vca.gain.linearRampToValueAtTime(gain, params.time + attack)
    vca.gain.linearRampToValueAtTime(gain, params.time + dur)
    vca.gain.linearRampToValueAtTime(0, params.time + dur + decay)
    params.endTime = params.time + dur + decay
    return vca
  }

  dsaw.play = (params) => {
    let degree = parseInt(params.sound)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, eval(params.oct) || 4)
    let detuneSemis = eval(params.detune) || 0.3

    let vca = envelope(params)
    play.mix(vca);

    let vcos = [0, 0.7, 1].map(lerp => {
      vco = play.audio.createOscillator()
      vco.type = 'sawtooth';
      vco.frequency.value = freq
      vco.detune.value = lerp * detuneSemis*100
      return vco
    })
    vcos.forEach(vco => vco.connect(vca))
    vcos.forEach(vco => vco.start(params.time))
    vcos.forEach(vco => vco.stop(params.endTime))
  }

  return dsaw;
});
