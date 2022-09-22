'use strict';
define(function (require) {
  let system = require('play/system');
  let effects = require('play/effects/effects')
  let waveEffects = require('play/effects/wave-effects')

  let clickBuffer
  let getClick = () => {
    if (clickBuffer === undefined) {
      const sampleRate = system.audio.sampleRate
      clickBuffer = system.audio.createBuffer(1, 0.001*sampleRate, sampleRate);
      let clickData = clickBuffer.getChannelData(0)
      for (var i = 0; i < clickData.length; i++) {
        clickData[i] = 1
      }
    }
    return clickBuffer
  }

  return (params) => {
    let gainBase = 0.1
    let gain = Math.max(0.0001, gainBase * (typeof params.amp === 'number' ? params.amp : 1))
    params.endTime = params._time + 0.01

    let vca = system.audio.createGain()
    vca.gain.value = gain
    let out = effects(params, vca)
    system.mix(out)

    let click = system.audio.createBufferSource()
    click.buffer = getClick()
    click.start(params._time)
    click.stop(params.endTime)

    waveEffects(params, click).connect(vca)
    system.disconnect(params, [click, vca])
  }
})
