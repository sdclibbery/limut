'use strict';
define(function(require) {
  let metronome = require('metronome')
  let {combineOverrides,applyOverrides} = require('player/override-params')

  let keyboardPlayer = (params, player, baseParams) => {
    let keyupListener = ({key}) => {
      let buttonIdx = parseInt(key) || 0
      for (let k in player.events) {
        let e = player.events[k]
        if (!!e._noteOff && e._keyboardNote === buttonIdx) {
          e._noteOff() // Call note off callback so sustain envelopes can move to release phase
          e._stopping = true
        }
      }
      if (!!player._shouldUnlisten && (!player.events || player.events.filter(e => !e._stopping).length === 0)) {
        removeEventListener("keydown", keydownListener)
        removeEventListener("keyup", keyupListener)
      }
    }
    addEventListener("keyup", keyupListener)
    let keydownListener = ({key, repeat}) => {
      if (repeat) { return }
      let buttonIdx = parseInt(key) || 0
      if (player._shouldUnlisten) { return } // Dont play any new events if player is being cleaned up!
      let event = {
        _keyboardNote: buttonIdx,
        value: buttonIdx,
        dur: 1,
        vel: 3/4,
        _time: metronome.timeNow(),
        count: metronome.lastBeat().count,
        idx: metronome.lastBeat().count,
        beat: metronome.lastBeat(),
      }
      event.sound = event.value
      event = combineOverrides(event, baseParams)
      event = applyOverrides(event, params)
      let events = player.processEvents([event])
      events.forEach(e => { e._noteOff = () => {} }) // Default _noteOff callback does nothing
      player.play(events)
    }
    addEventListener("keydown", keydownListener)
    if (player.destroy !== undefined) { throw `Player ${player.id} already has destroy?!` }
    player.destroy = () => {
      player._shouldUnlisten = true
      if (!!player.events && player.events.length === 0) {
        removeEventListener("keydown", keydownListener)
        removeEventListener("keyup", keyupListener)
      }
    }
  }

  return keyboardPlayer
})
