'use strict';
define(function(require) {
  let metronome = require('metronome')
  let {combineOverrides,applyOverrides} = require('player/override-params')
  let {releaseNotes,allStopped} = require('player/live-notes')

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
  let heldKeys = new Set() // Local keys currently down, so a key up that never arrives can still be made good
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
    heldKeys.add(noteKey)
    activePlayers.forEach(entry => entry.noteOn(noteKey, ctrlKey, shiftKey, altKey, 'local'))
    keyEventListeners.forEach(cb => cb(noteKey, 'down', ctrlKey, shiftKey, altKey))
  }
  // Shared by the key up and the blur below, so a note released either way still tells the peers
  let releaseKey = (noteKey) => {
    heldKeys.delete(noteKey)
    activePlayers.forEach(entry => entry.noteOff(noteKey, 'local'))
    keyEventListeners.forEach(cb => cb(noteKey, 'up'))
  }
  let globalKeyup = (e) => {
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt") { return }
    releaseKey(eventToKey(e))
  }
  // A key held when the window loses focus (alt tab, or a macOS Cmd combo) never delivers its key up,
  // so release it here: the note would otherwise sustain, and keep rendering, for ever
  let globalBlur = () => { Array.from(heldKeys).forEach(releaseKey) }
  let listenersAttached = false
  let ensureListeners = () => {
    if (listenersAttached) { return }
    addEventListener("keydown", globalKeydown)
    addEventListener("keyup", globalKeyup)
    addEventListener("blur", globalBlur)
    listenersAttached = true
  }
  let removePlayer = (entry) => {
    activePlayers.delete(entry)
    if (activePlayers.size === 0 && listenersAttached) {
      removeEventListener("keydown", globalKeydown)
      removeEventListener("keyup", globalKeyup)
      removeEventListener("blur", globalBlur)
      listenersAttached = false
    }
  }

  // A peer that disconnects mid note never sends its key up, so release everything it was playing
  let clearPeer = (peerId) => {
    let prefix = peerId + ':'
    activePlayers.forEach(entry => releaseNotes(entry.player, e => (''+e._keyboardNote).startsWith(prefix)))
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
      let noteId = source + ':' + keyToNote(key)
      releaseNotes(player, e => e._keyboardNote === noteId)
      if (!!player._shouldUnlisten && allStopped(player)) {
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
    entry = {noteOn, noteOff, player}
    activePlayers.add(entry)
    ensureListeners()
    if (player.destroy !== undefined) { throw `Player ${player.id} already has destroy?!` }
    player.destroy = (replaced) => {
      player._shouldUnlisten = true
      // Held notes are only released when the player is really going away (stop all, or its line
      // deleted): on a code re-run the events are handed to the replacement player, whose listener
      // still matches the key up, so a note held across the re-run is not cut
      if (!replaced) { releaseNotes(player) }
      if (allStopped(player)) {
        removePlayer(entry)
      }
    }
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual, msg) => {
    if (expected !== actual) { console.trace(`Assertion failed.\n>>Expected: ${expected}\n>>Actual: ${actual}${msg?'\n'+msg:''}`) }
  }
  let testPlayer = (id) => {
    let player = {id: id, _num: 0, events: []}
    player.processEvents = (es) => es
    player.play = (es) => es.forEach(e => player.events.push(e))
    return player
  }
  let press = (code) => dispatchEvent(new KeyboardEvent('keydown', {code: code}))
  let liveEvent = (player) => { // Stand in for a live envelope's release, which is what arms its teardown
    let e = player.events[player.events.length-1]
    e.released = 0
    e._noteOff = () => e.released++
    return e
  }
  let wasEnabled = localEnabled
  setLocalEnabled(true)

  { // A key held when the window loses focus is released: its key up never arrives
    let player = testPlayer('ktest1')
    keyboardPlayer({}, player, {})
    press('KeyA')
    assert(1, player.events.length, 'key press played a note')
    let e = liveEvent(player)
    dispatchEvent(new Event('blur'))
    assert(1, e.released, 'blur released the held note')
    dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyA'})) // The key up, if it ever comes, is a no-op
    assert(1, e.released)
    player.destroy()
  }

  { // Destroy releases held notes, but only when the player is really going away
    let player = testPlayer('ktest2')
    keyboardPlayer({}, player, {})
    press('KeyS')
    let e = liveEvent(player)
    player.destroy(true) // Replaced by a re-run of its line; the replacement will get the key up
    assert(0, e.released, 'a replaced player leaves its held notes sounding')
    player.destroy()
    assert(1, e.released, 'a destroyed player releases its held notes')
    dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyS'}))
  }

  { // A peer that disconnects mid note has its notes released, and only its own
    let player = testPlayer('ktest3')
    keyboardPlayer({}, player, {})
    handleRemoteKey('a', 'down', false, false, false, 'peer1')
    let peerEvent = liveEvent(player)
    handleRemoteKey('s', 'down', false, false, false, 'peer2')
    let otherEvent = liveEvent(player)
    clearPeer('peer1')
    assert(1, peerEvent.released, 'the disconnected peer\'s note was released')
    assert(0, otherEvent.released, 'the other peer\'s note was left alone')
    player.destroy()
  }

  setLocalEnabled(wasEnabled)
  console.log('Keyboard tests complete')
  }

  return {
    keyboardPlayer: keyboardPlayer,
    onKeyEvent: onKeyEvent,
    handleRemoteKey: handleRemoteKey,
    setLocalEnabled: setLocalEnabled,
    clearPeer: clearPeer,
  }
})
