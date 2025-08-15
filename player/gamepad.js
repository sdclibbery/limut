'use strict';
define(function(require) {
  let metronome = require('metronome')
  let {combineOverrides,applyOverrides} = require('player/override-params')

  let gamepads = []
  let perFrameUpdate = (now) => {
    navigator.getGamepads().forEach((pad,i) => {
      if (gamepads[i] === undefined) { // New pad, add it
        gamepads[i] = {
          lastButtons: undefined,
          listeners: {},
        }
      }
      let gamepad = gamepads[i]
      let buttons = pad.buttons.map(b => b.value)
      buttons.forEach((b,i) => {
          if (b > 0 && (gamepad.lastButtons === undefined || gamepad.lastButtons[i] <= 0)) { // Button press
              for (let id in gamepad.listeners) { gamepad.listeners[id](i, b) }
          }
          if (b <= 0 && gamepad.lastButtons !== undefined && gamepad.lastButtons[i] > 0) { // Button release
              for (let id in gamepad.listeners) { gamepad.listeners[id](i, undefined) }
          }
      })
      gamepad.lastButtons = buttons
    })
  }

  let addListener = (padIdx, id, listener) => {
    if (gamepads[padIdx]) {
      gamepads[padIdx].listeners[id] = listener
    }
  }

  let removeListener = (padIdx, id) => {
    if (gamepads[padIdx]) {
      delete gamepads[padIdx].listeners[id]
    }
  }

  let gamepadPlayer = (patternStr, params, player, baseParams) => {
    // parse pattern string to get pad
    let padNumber = parseInt(patternStr.trim(),10) || 0
    // listen for presses
    addListener(padNumber, player.id+player._num, (buttonIdx, value) => {
      if (value === undefined) { // Note off
        for (let k in player.events) {
          let e = player.events[k]
          if (!!e._noteOff && e._gamepadNote === buttonIdx) {
            e._noteOff() // Call note off callback so sustain envelopes can move to release phase
            e._stopping = true
          }
        }
        if (!!player._shouldUnlisten && (!player.events || player.events.filter(e => !e._stopping).length === 0)) {
          removeListener(padNumber, player.id+player._num) // Nothing left playing, cleanup listener
        }
        return
      }
      if (player._shouldUnlisten) { return } // Dont play any new events if player is being cleaned up!
console.log(buttonIdx)
      let event = {
        _gamepadNote: buttonIdx,
        value: buttonIdx,
        dur: 1,
        vel: value,
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
    })
    if (player.destroy !== undefined) { throw `Player ${player.id} already has destroy?!` }
    player.destroy = () => {
      player._shouldUnlisten = true
      if (!!player.events && player.events.length === 0) {
          removeListener(padNumber, player.id+player._num) // Nothing left playing, cleanup listener
      }
    }

    //   // Listen to given midi port/channel, create appropriate event and call player.play()
    //   midi.listen(port, channel, player.id+player._num, (note, velocity) => {
    //     if (velocity === undefined) { // Note off
    //       for (let k in player.events) {
    //         let e = player.events[k]
    //         if (!!e._noteOff && e._midiNote === note) {
    //           e._noteOff() // Call note off callback so sustain envelopes can move to release phase
    //           e._stopping = true
    //         }
    //       }
    //       if (!!player._shouldUnlisten && (!player.events || player.events.filter(e => !e._stopping).length === 0)) {
    //         midi.stopListening(port, channel, player.id+player._num) // Nothing left playing, cleanup listener
    //       }
    //       return
    //     }
    //     if (player._shouldUnlisten) { return } // Dont play any new events if player is being cleaned up!
    //     let event = {
    //       _midiNote: note,
    //       value: 0,
    //       dur: 1,
    //       vel: velocity,
    //       _time: metronome.timeNow(),
    //       count: metronome.lastBeat().count,
    //       idx: metronome.lastBeat().count,
    //       beat: metronome.lastBeat(),
    //     }
    //     applyMapping(event, note, mapping)
    //     let oct = event.oct
    //     event.sound = event.value
    //     event = combineOverrides(event, baseParams)
    //     event.oct = oct // Ignore base params and use the midi supplied octave
    //     event = applyOverrides(event, params)
    //     let events = player.processEvents([event])
    //     events.forEach(e => { e._noteOff = () => {} }) // Default _noteOff callback does nothing
    //     player.play(events)
    //   })
    //   // Disconnect midi listener on player cleanup
    //   if (player.destroy !== undefined) { throw `Player ${player.id} already has destroy?!` }
    //   player.destroy = () => {
    //     player._shouldUnlisten = true
    //     if (!!player.events && player.events.length === 0) {
    //       midi.stopListening(port, channel, player.id+player._num)
    //     }
    //   }
  }

  return {
    perFrameUpdate: perFrameUpdate,
    gamepadPlayer: gamepadPlayer,
  }
})
