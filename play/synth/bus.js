'use strict';
define(function (require) {
  let system = require('play/system');
  let envelope = require('play/envelopes')
  let effects = require('play/effects/effects')
  let waveEffects = require('play/effects/wave-effects')
  let {evalMainParamEvent} = require('play/eval-audio-params')

  return (params) => {
    let player = params._player
    if (!player.busIn) {
      player.busIn = system.audio.createGain()
    }
    let input = system.audio.createGain()
    player.busIn.connect(input)

    let vca = envelope(params, 1, 'pad')
    waveEffects(params, input).connect(vca)
    let out = effects(params, vca)
    let bus = evalMainParamEvent(params, 'bus')
    if (bus) {
      let busPlayer = players.instances[bus]
      if (busPlayer) {
        if (!busPlayer.busIn) {
          busPlayer.busIn = system.audio.createGain()
        }
        out.connect(busPlayer.busIn)
      } // Do nothing if bus player not present
    } else {
      system.mix(out)
    }

    system.disconnect(params, [vca, input])
    setTimeout(() => {
      player.busIn.disconnect(input)
    }, 100+(params.endTime - system.audio.currentTime)*1000)
  }
})
