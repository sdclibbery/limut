'use strict';
define(function(require) {
  let metronome = require('metronome')
  let {combineOverrides,applyOverrides} = require('player/override-params')
  let consoleOut = require('console')

  let pressThreshold = 0.95 // For analogue button, have to press it this far before it triggers

  let gamepads = []
  let perFrameUpdate = (now) => {
    navigator.getGamepads().forEach((pad,i) => {
      if (!pad) { return }
      if (gamepads[i] === undefined) { // New pad, add it
        gamepads[i] = {
          lastButtons: undefined,
          listeners: {},
        }
      }
      let gamepad = gamepads[i]
      gamepad.mapping = pad.mapping
      let buttons = pad.buttons.map(b => b.value)
      buttons.forEach((b,i) => {
          if (b > pressThreshold && (gamepad.lastButtons === undefined || gamepad.lastButtons[i] <= pressThreshold)) { // Button press
              for (let id in gamepad.listeners) { gamepad.listeners[id](i, b) }
          }
          if (b <= pressThreshold && gamepad.lastButtons !== undefined && gamepad.lastButtons[i] > pressThreshold) { // Button release
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
    let nodpad = false
    let patternArgs = patternStr.split(/\s+/)
    patternArgs = patternArgs
      .map(arg => arg.trim())
      .filter(arg => arg !== '')
      .map(arg => typeof arg === 'string' ? arg.trim().toLowerCase() : arg)
      .map(arg => !isNaN(parseInt(arg,10)) ? parseInt(arg,10) : arg)
    if (patternArgs.filter(a => a === 'nodpad').length > 0) { nodpad = true }
    patternArgs = patternArgs.filter(a => typeof a === 'number')
    let padNumber = patternArgs.length > 0 ? patternArgs[0] : 0
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
      if (gamepads[padNumber].mapping !== 'standard' && nodpad) { consoleOut('🔴 nodpad will not work correctly on non-standard mapping gamepad!') }
      if (nodpad && buttonIdx >= 12 && buttonIdx <= 15) { return } // Ignore dpad buttons if nodpad
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
  }

  return {
    perFrameUpdate: perFrameUpdate,
    gamepadPlayer: gamepadPlayer,
  }
})
