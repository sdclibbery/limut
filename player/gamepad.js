'use strict';
define(function(require) {
  let metronome = require('metronome')
  let {combineOverrides,applyOverrides} = require('player/override-params')
  let {releaseNotes,allStopped} = require('player/live-notes')
  let consoleOut = require('console')

  let pressThreshold = 0.95 // For analogue button, have to press it this far before it triggers

  // Remote gamepads received from connected peers. Map<peerId, Map<padIdx, padSnapshot>>.
  // padSnapshot has the shape { id, mapping, axes, buttons:[{value,...}], connected }.
  let remotePads = new Map()

  let setRemotePad = (peerId, padIdx, padData) => {
    let peerMap = remotePads.get(peerId)
    if (padData === null || padData === undefined) {
      if (peerMap) {
        peerMap.delete(padIdx)
        if (peerMap.size === 0) { remotePads.delete(peerId) }
      }
      return
    }
    if (!peerMap) { peerMap = new Map(); remotePads.set(peerId, peerMap) }
    peerMap.set(padIdx, padData)
  }

  let clearPeer = (peerId) => { remotePads.delete(peerId) }

  let getGamepads = () => {
    let local = (typeof navigator !== 'undefined' && navigator.getGamepads) ? Array.from(navigator.getGamepads()) : []
    let merged = local.slice()
    let placeAt = (pad) => {
      for (let i = 0; i < merged.length; i++) {
        if (!merged[i]) { merged[i] = pad; return }
      }
      merged.push(pad)
    }
    remotePads.forEach((peerMap) => {
      peerMap.forEach((padData) => { placeAt(padData) })
    })
    return merged
  }

  let gamepads = []
  // A pad that goes away with a button held (unplugged, or a peer disconnecting) never reports the
  // release, so the note it started would sustain, and keep rendering, for ever. Release its held
  // buttons here. The pad state itself stays: the players' listeners live in it. lastButtons is
  // zeroed rather than cleared so a pad that comes back with the button still down doesn't read as
  // a fresh press.
  let isLive = (pad) => !!pad && pad.connected !== false
  let releaseVanishedPads = (pads) => {
    gamepads.forEach((gamepad, i) => {
      if (!gamepad || isLive(pads[i]) || gamepad.lastButtons === undefined) { return }
      gamepad.lastButtons.forEach((b, buttonIdx) => {
        if (b <= pressThreshold) { return }
        for (let id in gamepad.listeners) { gamepad.listeners[id](buttonIdx, undefined) }
      })
      gamepad.lastButtons = gamepad.lastButtons.map(() => 0)
      gamepad.lt = 0
      gamepad.rt = 0
    })
  }

  let perFrameUpdate = (now) => {
    let pads = getGamepads()
    releaseVanishedPads(pads)
    pads.forEach((pad,i) => {
      if (!isLive(pad)) { return } // A disconnected pad is handled by releaseVanishedPads, not read here
      if (gamepads[i] === undefined) { // New pad, add it
        gamepads[i] = {
          lastButtons: undefined,
          listeners: {},
          mapping: pad.mapping,
          lt: 0,
          rt: 0,
        }
      }
      let gamepad = gamepads[i]
      let buttons = pad.buttons.map(b => b.value)
      buttons.forEach((b,i) => {
          if (b > pressThreshold && (gamepad.lastButtons === undefined || gamepad.lastButtons[i] <= pressThreshold)) { // Button press
              for (let id in gamepad.listeners) { gamepad.listeners[id](i, b) }
          }
          if (b <= pressThreshold && gamepad.lastButtons !== undefined && gamepad.lastButtons[i] > pressThreshold) { // Button release
              for (let id in gamepad.listeners) { gamepad.listeners[id](i, undefined) }
          }
      })
      gamepad.lt = buttons[6] || 0
      gamepad.rt = buttons[7] || 0
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
    let ltParam, rtParam
    let patternArgs = patternStr.split(/\s+/)
    patternArgs = patternArgs
      .map(arg => arg.trim())
      .filter(arg => arg !== '')
      .map(arg => typeof arg === 'string' ? arg.trim().toLowerCase() : arg)
      .map(arg => !isNaN(parseInt(arg,10)) ? parseInt(arg,10) : arg)
    if (patternArgs.filter(a => a === 'nodpad').length > 0) { nodpad = true }
    let ltArg = patternArgs.find(a => typeof a === 'string' && a.startsWith('lt:'))
    if (ltArg) { ltParam = ltArg.split(':')[1] }
    let rtArg = patternArgs.find(a => typeof a === 'string' && a.startsWith('rt:'))
    if (rtArg) { rtParam = rtArg.split(':')[1] }
    patternArgs = patternArgs.filter(a => typeof a === 'number')
    let padNumber = patternArgs.length > 0 ? patternArgs[0] : 0
    // listen for presses
    addListener(padNumber, player.id+player._num, (buttonIdx, value) => {
      if (ltParam && buttonIdx === 6) { return } // Ignore left trigger button presses if ltParam
      if (rtParam && buttonIdx === 7) { return } // Ignore right trigger button presses if rtParam
      if (buttonIdx === 10 || buttonIdx === 11) { return } // Ignore stick presses
      if (value === undefined) { // Note off
        releaseNotes(player, e => e._gamepadNote === buttonIdx)
        if (!!player._shouldUnlisten && allStopped(player)) {
          removeListener(padNumber, player.id+player._num) // Nothing left playing, cleanup listener
        }
        return
      }
      if (player._shouldUnlisten) { return } // Dont play any new events if player is being cleaned up!
      if (gamepads[padNumber].mapping !== 'standard' && nodpad) { consoleOut('🔴 nodpad will not work correctly on non-standard mapping gamepad!') }
      if (nodpad && buttonIdx >= 12 && buttonIdx <= 15) { return } // Ignore dpad buttons if nodpad
      let now = metronome.timeNow()
      let currentCount = metronome.beatTime(now)
      let lastBeat = metronome.lastBeat()
      let event = {
        _gamepadNote: buttonIdx,
        value: buttonIdx,
        dur: 1,
        vel: 3/4,
        _time: now,
        count: currentCount,
        idx: lastBeat.count,
        beat: Object.assign({}, lastBeat, {count: currentCount, time: now}),
      }
      event.sound = event.value
      event = combineOverrides(event, baseParams) // Apply base params before lt/rt so they can override base if needed
      if (ltParam) {
        event[ltParam] = () => {
          if (gamepads[padNumber] === undefined || gamepads[padNumber].lt === undefined) { return 0 }
          return gamepads[padNumber].lt || 0
        }
        event[ltParam].interval = 'frame'
        event[ltParam].isNonTemporal = true
      }
      if (rtParam) {
        event[rtParam] = () => {
          if (gamepads[padNumber] === undefined || gamepads[padNumber].rt === undefined) { return 0 }
          return gamepads[padNumber].rt || 0
        }
        event[rtParam].interval = 'frame'
        event[rtParam].isNonTemporal = true
      }
      event = applyOverrides(event, params)
      let events = player.processEvents([event])
      events.forEach(e => { e._noteOff = () => {} }) // Default _noteOff callback does nothing
      player.play(events)
    })
    if (player.destroy !== undefined) { throw `Player ${player.id} already has destroy?!` }
    player.destroy = (replaced) => {
      player._shouldUnlisten = true
      // Held notes are only released when the player is really going away (stop all, or its line
      // deleted): on a code re-run the events are handed to the replacement player, whose listener
      // still matches the button release, so a note held across the re-run is not cut
      if (!replaced) { releaseNotes(player) }
      if (allStopped(player)) {
          removeListener(padNumber, player.id+player._num) // Nothing left playing, cleanup listener
      }
    }
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual, msg) => {
    if (expected !== actual) { console.trace(`Assertion failed.\n>>Expected: ${expected}\n>>Actual: ${actual}${msg?'\n'+msg:''}`) }
  }

  { // A pad that goes away with a button held releases it: no button release is ever reported for it
    let fakePad = (pressed) => { return {id:'test', mapping:'standard', connected:true, axes:[], buttons:[{value:pressed?1:0},{value:0}]} }
    let pad = fakePad(false)
    setRemotePad('testpeer', 0, pad)
    let idx = getGamepads().indexOf(pad)
    perFrameUpdate(0) // Pad arrives with nothing pressed
    let calls = []
    addListener(idx, 'testlistener', (buttonIdx, value) => calls.push([buttonIdx, value]))
    setRemotePad('testpeer', 0, fakePad(true))
    perFrameUpdate(0)
    assert('0,1', ''+calls[0], 'button press reported')
    setRemotePad('testpeer', 0, null) // Peer disconnects (or the pad is unplugged) with the button still down
    perFrameUpdate(0)
    assert(2, calls.length, 'the vanished pad released its held button')
    assert('0,', ''+calls[1], 'reported as a release')
    perFrameUpdate(0)
    assert(2, calls.length, 'and only once')
    removeListener(idx, 'testlistener')
    delete gamepads[idx]
  }

  console.log('Gamepad tests complete')
  }

  return {
    perFrameUpdate: perFrameUpdate,
    gamepadPlayer: gamepadPlayer,
    getGamepads: getGamepads,
    setRemotePad: setRemotePad,
    clearPeer: clearPeer,
  }
})
