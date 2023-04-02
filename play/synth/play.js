'use strict';
define(function (require) {
  let system = require('play/system');
  let {getBuffer,getUrl} = require('play/samples')
  let effects = require('play/effects/effects')
  let {fxMixChain} = require('play/effects/fxMixChain')
  let waveEffects = require('play/effects/wave-effects')
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let perFrameAmp = require('play/effects/perFrameAmp')
  let destructor = require('play/destructor')

  return (params) => {
    let rate = evalMainParamEvent(params, 'rate', 1)
    let source = system.audio.createBufferSource()
    source.buffer = getBuffer(getUrl(params.sound, evalMainParamEvent(params, 'sample', 1)))
    source.playbackRate.value = rate
    let eventDur = evalMainParamEvent(params, 'sus', 1e10) * params.beat.duration
    let bufferDur =  (source.buffer ? source.buffer.duration : 0.1)
    params.endTime = params._time + Math.min(eventDur, bufferDur)
    params._destructor = destructor()
    setTimeout(() => params._destructor.destroy(), 100+(params.endTime - system.audio.currentTime)*1000)

    let vca = system.audio.createGain()
    let gainbase = 0.18 * evalMainParamEvent(params, "loud", 1)
    vca.gain.value = Math.max(0, gainbase * (typeof params.amp === 'number' ? params.amp : 1))
    waveEffects(params, source).connect(vca)
    fxMixChain(params, effects(params, perFrameAmp(params, vca)))
    source.start(params._time)
    params._destructor.disconnect(vca, source)
    params._destructor.stop(source)
  }
});
