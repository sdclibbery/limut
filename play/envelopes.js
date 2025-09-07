'use strict';
define(function (require) {
  let system = require('play/system');
  let {evalMainParamEvent,evalMainParamFrame,evalSubParamEvent} = require('play/eval-audio-params')
  let destructor = require('play/destructor')

  let fullEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'))
    dur *= evalMainParamEvent(params, "long", 1)
    let attack = evalMainParamEvent(params, 'att', 0.09, 'b') * params.beat.duration
    let decay = evalMainParamEvent(params, 'dec', 0.08*dur, 'b') * params.beat.duration
    let sustain = evalMainParamEvent(params, 'sus', dur, 'b') * params.beat.duration - decay
    if (params._noteOff !== undefined) { sustain = undefined } // "live" envelope, use note off to determine when to release
    let susLevel = evalSubParamEvent(params, 'sus', 'level', 0.8)
    let release = evalMainParamEvent(params, 'rel', 0.1*dur, 'b') * params.beat.duration
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(0)
    vca.gain.setValueAtTime(0, 0)
    vca.gain.setValueAtTime(0, params._time)
    vca.gain.linearRampToValueAtTime(gain, params._time + attack)
    vca.gain.linearRampToValueAtTime(gain*susLevel, params._time + attack+decay)
    if (sustain !== undefined) {
      vca.gain.linearRampToValueAtTime(gain*susLevel*0.8, params._time + attack+decay+sustain)
      vca.gain.linearRampToValueAtTime(0, params._time + attack+decay+sustain+release)
      params.endTime = params._time + attack+decay+sustain+release
      setTimeout(() => params._destructor.destroy(), 100+(params.endTime - system.audio.currentTime)*1000)
    } else {
      params.endTime = params._time + 1e6
      params._noteOff = () => {
        vca.gain.linearRampToValueAtTime(gain*susLevel*0.8, system.audio.currentTime)
        vca.gain.linearRampToValueAtTime(0, system.audio.currentTime+release)
        params.endTime = system.audio.currentTime+release
        setTimeout(() => params._destructor.destroy(), 100+(params.endTime - system.audio.currentTime)*1000)
      }
    }

    params._destructor.disconnect(vca)
    return vca
  }

  let organEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'))
    dur *= evalMainParamEvent(params, "long", 1)
    let attack = evalMainParamEvent(params, 'att', 0.01, 'b') * params.beat.duration
    let sustain = dur * params.beat.duration
    if (params._noteOff !== undefined) { sustain = undefined } // "live" envelope, use note off to determine when to release
    let release = evalMainParamEvent(params, 'rel', 0.1, 'b') * params.beat.duration
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(0)
    vca.gain.setValueAtTime(0, 0)
    vca.gain.setValueAtTime(0, params._time)
    vca.gain.linearRampToValueAtTime(gain, params._time + attack)
    if (sustain !== undefined) {
      vca.gain.linearRampToValueAtTime(gain, params._time + attack+sustain)
      vca.gain.exponentialRampToValueAtTime(0.00001, params._time + attack+sustain+release)
      params.endTime = params._time + attack+sustain+release
      setTimeout(() => params._destructor.destroy(), 100+(params.endTime - system.audio.currentTime)*1000)
    } else {
      params.endTime = params._time + 1e6
      params._noteOff = () => {
        vca.gain.setValueAtTime(gain, system.audio.currentTime)
        vca.gain.linearRampToValueAtTime(0.00001, system.audio.currentTime+release)
        params.endTime = system.audio.currentTime+release
        setTimeout(() => params._destructor.destroy(), 100+(params.endTime - system.audio.currentTime)*1000)
      }
    }
    params._destructor.disconnect(vca)
    return vca
  }

  let simpleEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'))
    dur *= evalMainParamEvent(params, "long", 1)
    let attack = evalMainParamEvent(params, 'att', 0.09, 'b') * params.beat.duration
    let decay = evalMainParamEvent(params, 'dec', 0.08*dur, 'b') * params.beat.duration
    let susLevel = evalSubParamEvent(params, 'sus', 'level', 0.8)
    let release = evalMainParamEvent(params, 'rel', dur, 'b') * params.beat.duration
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(0)
    vca.gain.setValueAtTime(0, 0)
    vca.gain.setValueAtTime(0, params._time)
    vca.gain.linearRampToValueAtTime(gain, params._time + attack)
    vca.gain.linearRampToValueAtTime(gain*susLevel, params._time + attack+decay)
    vca.gain.linearRampToValueAtTime(0, params._time + attack+decay+release)
    params.endTime = params._time + attack+decay+release
    params._destructor.disconnect(vca)
    setTimeout(() => params._destructor.destroy(), 100+(params.endTime - system.audio.currentTime)*1000)
    return vca
  }

  let percussionEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'))
    dur *= evalMainParamEvent(params, "long", 1)
    let decay = evalMainParamEvent(params, 'dec', evalMainParamEvent(params, 'rel', dur, 'b'), 'b') * params.beat.duration
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(0)
    vca.gain.setValueAtTime(0, 0)
    vca.gain.setValueAtTime(gain, params._time)
    vca.gain.linearRampToValueAtTime(0, params._time + decay)
    params.endTime = params._time + decay
    params._destructor.disconnect(vca)
    setTimeout(() => params._destructor.destroy(), 100+(params.endTime - system.audio.currentTime)*1000)
    return vca
  }

  let exponentialPercussionEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'))
    dur *= evalMainParamEvent(params, "long", 1)
    let decay = evalMainParamEvent(params, 'dec', evalMainParamEvent(params, 'rel', dur, 'b'), 'b') * params.beat.duration
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain();
    vca.gain.cancelScheduledValues(0)
    vca.gain.setValueAtTime(0, 0)
    vca.gain.setValueAtTime(0, params._time)
    vca.gain.linearRampToValueAtTime(gain, params._time+0.001) // 1ms attack
    vca.gain.exponentialRampToValueAtTime(0.0001, params._time + decay)
    params.endTime = params._time + decay
    params._destructor.disconnect(vca)
    setTimeout(() => params._destructor.destroy(), 100+(params.endTime - system.audio.currentTime)*1000)
    return vca
  }

  let noneEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'))
    dur *= evalMainParamEvent(params, "long", 1)
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain();
    vca.gain.value = gain
    params.endTime = params._time + dur
    params._destructor.disconnect(vca)
    setTimeout(() => params._destructor.destroy(), 100+(params.endTime - system.audio.currentTime)*1000)
    return vca
  }

  let fadeUpCosine = (vca, gain, time, duration) => {
    for (let i = 0; i < 16; i++) {
      vca.gain.linearRampToValueAtTime(Math.sin(i/15 * 0.5*Math.PI)*gain, time + i/15 * duration)
    }
  }
  let fadeDownCosine = (vca, gain, time, duration) => {
    for (let i = 0; i < 16; i++) {
      vca.gain.linearRampToValueAtTime(Math.cos(i/15 * 0.5*Math.PI)*gain, time + i/15 * duration)
    }
  }

  let fadeUpLinear = (vca, gain, time, duration) => {
    vca.gain.setValueAtTime(0, time)
    vca.gain.linearRampToValueAtTime(gain, time + duration)
  }
  let fadeDownLinear = (vca, gain, time, duration) => {
    vca.gain.setValueAtTime(gain, time)
    vca.gain.linearRampToValueAtTime(0, time + duration)
  }

  let padEnvelope = (params, gainBase, type) => {
    let fadeUpAtTime = fadeUpCosine
    let fadeDownAtTime = fadeDownCosine
    if (type === 'linear') {
      fadeUpAtTime = fadeUpLinear
      fadeDownAtTime = fadeDownLinear
    }
    let dur = Math.max(evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'), 0.01)
    dur *= evalMainParamEvent(params, "long", 1)
    let attack = Math.max(evalMainParamEvent(params, 'att', dur, 'b') * params.beat.duration, 0.001)
    let release = Math.max(evalMainParamEvent(params, 'rel', dur, 'b') * params.beat.duration, 0.001)
    let sus = Math.max(dur*params.beat.duration - attack, 0.001)
    if (params._noteOff !== undefined) { sus = undefined } // "live" envelope, use note off to determine when to release
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain()
    vca.gain.cancelScheduledValues(0)
    vca.gain.setValueAtTime(0, 0)
    vca.gain.setValueAtTime(0, params._time)
    fadeUpAtTime(vca, gain, params._time, attack)
    if (sus !== undefined) {
      fadeDownAtTime(vca, gain, params._time + attack+sus, release)
      params.endTime = params._time + attack+sus+release
      setTimeout(() => params._destructor.destroy(), 100+(params.endTime - system.audio.currentTime)*1000)
    } else {
      params.endTime = params._time + 1e6
      params._noteOff = () => {
        let relTime = Math.max(params._time + attack, system.audio.currentTime) + 0.1
        fadeDownAtTime(vca, gain, relTime, release)
        params.endTime = relTime+release
        setTimeout(() => params._destructor.destroy(), 100+(params.endTime - system.audio.currentTime)*1000)
      }
    }
    params._destructor.disconnect(vca)
    return vca
  }

  let customEnvelope = (params, gainBase) => {
    let dur = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'))
    dur *= evalMainParamEvent(params, "long", 1)
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    let vca = system.audio.createGain()
    evalMainParamFrame(vca.gain, params, 'envelope', 1, undefined, g => g*gain)
    params.endTime = params._time + dur
    params._destructor.disconnect(vca)
    setTimeout(() => params._destructor.destroy(), 100+(params.endTime - system.audio.currentTime)*1000)
    return vca
  }

  return (params, gainbase, defaultEnvelope) => {
    params._destructor = destructor()
    gainbase *= evalMainParamEvent(params, "loud", 1)
    let envelope = evalMainParamEvent(params, "envelope", defaultEnvelope)
    let env
    if (typeof envelope === 'string') {
      switch (envelope) {
        case 'full': env = fullEnvelope(params, gainbase); break
        case 'organ': env = organEnvelope(params, gainbase); break
        case 'simple': env = simpleEnvelope(params, gainbase); break
        case 'pad': env = padEnvelope(params, gainbase, 'cosine'); break
        case 'linpad': env = padEnvelope(params, gainbase, 'linear'); break
        case 'percussion': env = percussionEnvelope(params, gainbase); break
        case 'perc': env = percussionEnvelope(params, gainbase); break
        case 'exp': env = exponentialPercussionEnvelope(params, gainbase); break
        case 'none': env = noneEnvelope(params, gainbase); break
        default: env = fullEnvelope(params, gainbase); break
      }
    } else {
      env = customEnvelope(params, gainbase)
    }
    return env
  }
})
