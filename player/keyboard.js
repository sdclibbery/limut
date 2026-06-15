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
  // Derive a layout/modifier-stable key char from the physical key code. On macOS
  // holding Alt/Option rewrites event.key to an accented char ('a' -> 'å'), which
  // would map to note 0; event.code stays 'KeyA' regardless of held modifiers.
  let eventToKey = (e) => {
    let code = e.code || ''
    if (code.startsWith('Key')) { return code.slice(3).toLowerCase() } // 'KeyA' -> 'a'
    if (code.startsWith('Digit')) { return code.slice(5) } // 'Digit3' -> '3'
    return e.key // Fall back to the logical key for anything else
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

  let globalKeydown = (e) => {
    let {key, repeat, ctrlKey, shiftKey, altKey} = e
    if (repeat) { return }
    if (key === "Shift" || key === "Control" || key === "Alt") { return } // Modifier keys set velocity/sharpen, dont play a note
    if (!localEnabled) { return } // Only play local notes while hovering the keyboard icon
    let noteKey = eventToKey(e)
    activePlayers.forEach(entry => entry.noteOn(noteKey, ctrlKey, shiftKey, altKey, 'local'))
    keyEventListeners.forEach(cb => cb(noteKey, 'down', ctrlKey, shiftKey, altKey))
  }
  let globalKeyup = (e) => {
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt") { return }
    let noteKey = eventToKey(e)
    activePlayers.forEach(entry => entry.noteOff(noteKey, 'local'))
    keyEventListeners.forEach(cb => cb(noteKey, 'up'))
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
  let handleRemoteKey = (key, action, ctrlKey, shiftKey, altKey, source) => {
    if (action === 'down') {
      activePlayers.forEach(entry => entry.noteOn(key, ctrlKey, shiftKey, altKey, source))
    } else {
      activePlayers.forEach(entry => entry.noteOff(key, source))
    }
  }

  let keyboardPlayer = (params, player, baseParams) => {
    let entry
    let noteOff = (key, source) => {
      let noteValue = keyToNote(key)
      let noteId = source + ':' + noteValue
      for (let k in player.events) {
        let e = player.events[k]
        if (!!e._noteOff && !e._stopping && e._keyboardNote === noteId) { // Skip voices already releasing, else re-triggering _noteOff jumps the gain back up (click) and races the original destroy timeout
          e._noteOff() // Call note off callback so sustain envelopes can move to release phase
          e._stopping = true
        }
      }
      if (!!player._shouldUnlisten && (!player.events || player.events.filter(e => !e._stopping).length === 0)) {
        removePlayer(entry)
      }
    }
    let noteOn = (key, ctrlKey, shiftKey, altKey, source) => {
      let noteValue = keyToNote(key)
      if (player._shouldUnlisten) { return } // Dont play any new events if player is being cleaned up!
      let now = metronome.timeNow()
      let currentCount = metronome.beatTime(now)
      let lastBeat = metronome.lastBeat()
      let event = {
        _keyboardNote: source + ':' + noteValue, // Namespaced by source so peers' note-offs dont collide
        value: noteValue,
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
      if (altKey) { event.sharp = 1 } // Sharpen the note a semitone when alt/option is held
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
