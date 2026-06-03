'use strict';
define(function(require) {
  let metronome = require('metronome')
  let {combineOverrides,applyOverrides} = require('player/override-params')

  // Map alphabet keys to notes, row by row. Home row starts at 0 (a=0..l=8),
  // top row starts an octave up at 7 (q=7..), bottom row starts at -7 (z=-7..).
  let rowNotes = {}
  let addRow = (keys, start) => keys.split('').forEach((k, i) => rowNotes[k] = start + i)
  addRow("asdfghjkl", 0)
  addRow("qwertyuiop", 7)
  addRow("zxcvbnm", -7)
  let keyToNote = (key) => {
    let note = rowNotes[(key || '').toLowerCase()]
    return note !== undefined ? note : (parseInt(key) || 0)
  }

  // Module-level registry of active keyboard players. Each entry is {noteOn, noteOff}.
  // A single pair of global window listeners dispatches each physical key press to
  // every active player (so a press broadcasts exactly once) and lets remote peer
  // events be injected via handleRemoteKey.
  let activePlayers = new Set()
  let keyEventListeners = []
  let onKeyEvent = (cb) => keyEventListeners.push(cb)

  // Local key presses only play (and broadcast to peers) while this is true; the UI
  // sets it when the mouse hovers the keyboard icon. Note-off is never gated, so a key
  // held while leaving the icon still releases cleanly.
  let localEnabled = false
  let setLocalEnabled = (enabled) => { localEnabled = !!enabled }

  let globalKeydown = ({key, repeat, ctrlKey, shiftKey}) => {
    if (repeat) { return }
    if (key === "Shift" || key === "Control") { return } // Modifier keys set velocity, dont play a note
    if (!localEnabled) { return } // Only play local notes while hovering the keyboard icon
    activePlayers.forEach(entry => entry.noteOn(key, ctrlKey, shiftKey, 'local'))
    keyEventListeners.forEach(cb => cb(key, 'down', ctrlKey, shiftKey))
  }
  let globalKeyup = ({key}) => {
    if (key === "Shift" || key === "Control") { return }
    activePlayers.forEach(entry => entry.noteOff(key, 'local'))
    keyEventListeners.forEach(cb => cb(key, 'up'))
  }
  let listenersAttached = false
  let ensureListeners = () => {
    if (listenersAttached) { return }
    addEventListener("keydown", globalKeydown)
    addEventListener("keyup", globalKeyup)
    listenersAttached = true
  }
  let removePlayer = (entry) => {
    activePlayers.delete(entry)
    if (activePlayers.size === 0 && listenersAttached) {
      removeEventListener("keydown", globalKeydown)
      removeEventListener("keyup", globalKeyup)
      listenersAttached = false
    }
  }

  // Apply a remote peer's key event to every active player, namespaced by source
  // (the peer id) so peers' note-offs dont collide. Does not re-notify listeners.
  let handleRemoteKey = (key, action, ctrlKey, shiftKey, source) => {
    if (action === 'down') {
      activePlayers.forEach(entry => entry.noteOn(key, ctrlKey, shiftKey, source))
    } else {
      activePlayers.forEach(entry => entry.noteOff(key, source))
    }
  }

  let keyboardPlayer = (params, player, baseParams) => {
    let entry
    let noteOff = (key, source) => {
      let buttonIdx = keyToNote(key)
      let noteId = source + ':' + buttonIdx
      for (let k in player.events) {
        let e = player.events[k]
        if (!!e._noteOff && e._keyboardNote === noteId) {
          e._noteOff() // Call note off callback so sustain envelopes can move to release phase
          e._stopping = true
        }
      }
      if (!!player._shouldUnlisten && (!player.events || player.events.filter(e => !e._stopping).length === 0)) {
        removePlayer(entry)
      }
    }
    let noteOn = (key, ctrlKey, shiftKey, source) => {
      let buttonIdx = keyToNote(key)
      if (player._shouldUnlisten) { return } // Dont play any new events if player is being cleaned up!
      let now = metronome.timeNow()
      let currentCount = metronome.beatTime(now)
      let lastBeat = metronome.lastBeat()
      let event = {
        _keyboardNote: source + ':' + buttonIdx, // Namespaced by source so peers' note-offs dont collide
        value: buttonIdx,
        dur: 1,
        vel: 3/4,
        _time: now,
        count: currentCount,
        idx: lastBeat.count,
        beat: Object.assign({}, lastBeat, {count: currentCount, time: now}),
      }
      event.sound = event.value
      event = combineOverrides(event, baseParams)
      // Set velocity from modifier keys after baseParams (whose default vel would otherwise clobber it)
      if (ctrlKey) { event.vel = 1/2 } // Half velocity when control is held
      if (shiftKey) { event.vel = 1 } // Full velocity when shift is held
      event = applyOverrides(event, params)
      let events = player.processEvents([event])
      events.forEach(e => { e._noteOff = () => {} }) // Default _noteOff callback does nothing
      player.play(events)
    }
    entry = {noteOn, noteOff}
    activePlayers.add(entry)
    ensureListeners()
    if (player.destroy !== undefined) { throw `Player ${player.id} already has destroy?!` }
    player.destroy = () => {
      player._shouldUnlisten = true
      if (!!player.events && player.events.length === 0) {
        removePlayer(entry)
      }
    }
  }

  return {
    keyboardPlayer: keyboardPlayer,
    onKeyEvent: onKeyEvent,
    handleRemoteKey: handleRemoteKey,
    setLocalEnabled: setLocalEnabled,
  }
})
