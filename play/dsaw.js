define(function (require) {
  let system = require('play/system');
  let scale = require('music/scale');

  let envelope = (params, gainBase) => {
    let dur = Math.max(0.01, (eval(params.sus) || eval(params.dur) || 0.25))
    let attack = (eval(params.attack) || 0.09) * params.beat.duration
    params.time -= Math.min(attack, 0.05)
    let decay = (eval(params.decay) || 0.08*dur) * params.beat.duration
    let sustain = ((eval(params.sus) || dur) * params.beat.duration) - decay
    let susLevel = eval(params.suslevel) || 0.8
    let release = (eval(params.release) || 0.1*dur) * params.beat.duration
    let gain = Math.max(0.0001, gainBase * (eval(params.amp) || 1))
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(params.time)
    vca.gain.setValueAtTime(0, params.time)
    vca.gain.linearRampToValueAtTime(gain, params.time + attack)
    vca.gain.linearRampToValueAtTime(gain*susLevel, params.time + attack+decay)
    vca.gain.linearRampToValueAtTime(gain*susLevel*0.8, params.time + attack+decay+sustain)
    vca.gain.linearRampToValueAtTime(0, params.time + attack+decay+sustain+release)
    params.endTime = params.time + attack+decay+sustain+release
    return vca
  }

  let echo = (params, source) => {
    let delay = (eval(params.echo) || 0) * params.beat.duration
    if (delay < 0.0001) { return }
    let delayer = system.audio.createDelay(delay)
    delayer.delayTime.value = delay
    let delayGain = system.audio.createGain()
    delayGain.gain.value = 1/2
    source.connect(delayer)
    delayer.connect(delayGain)
    delayGain.connect(delayer)
    system.mix(delayGain)
  }

  return (params) => {
    let degree = parseInt(params.sound)
    if (isNaN(degree)) { return }
    let freq = scale.degreeToFreq(degree, eval(params.oct) || 4)
    let detuneSemis = eval(params.detune) || 0.1

    let vca = envelope(params, 0.01)
    system.mix(vca)
    echo(params, vca)

    let vcos = [0, 0.7, 1].map(lerp => {
      vco = system.audio.createOscillator()
      vco.type = 'sawtooth';
      vco.frequency.value = freq
      vco.detune.value = lerp * detuneSemis*100
      return vco
    })
    vcos.forEach(vco => vco.connect(vca))
    vcos.forEach(vco => vco.start(params.time))
    vcos.forEach(vco => vco.stop(params.endTime))
  }
});
