'use strict';
define(function(require) {
  let midi = require('midi')
  let metronome = require('metronome')
  let system = require('play/system')
  let {combineOverrides,applyOverrides} = require('player/override-params')
  let {releaseNotes,allStopped} = require('player/live-notes')
  let scale = require('music/scale')

  let midiNoteToOctave = (note) => {
    return Math.floor(note / 12) - 1
  }
  let midiNoteToChromatic = (note) => {
    return note % 12
  }

  let applyMapping = (event, note, mapping) => {
    if (mapping === 'perc') {
      event.value = {
        35:'x', 36:'X', 37:'t', 38:'o', 39:'H', 40:'u', 41:'m', 42:'-', 43:'M',
        46:'o', 49:'#', 54:'S', 56:'T', 
      }[note] || '-'
    } else { // 'abs': absolute  chromatic note value
      let root = scale.root || 0
      event.oct = midiNoteToOctave(note - root)
      let chromatic = midiNoteToChromatic(note - root) // Correct for root (key)
      event.value = chromatic
      event.scale = 'chromatic' // Force to chromatic scale
    }
  }

  let midiPlayer = (patternStr, params, player, baseParams) => {
      // parse pattern string to get port/channel
      let patternArgs = patternStr.split(/\s+/)
      let mapping = 'abs'
      let port, channel
      patternArgs = patternArgs
        .map(arg => arg.trim())
        .filter(arg => arg !== '')
        .map(arg => !isNaN(parseInt(arg,10)) ? parseInt(arg,10) : arg)
      if (typeof patternArgs[0] === 'string')  {
        mapping = patternArgs[0]
        patternArgs = patternArgs.slice(1)
      }
      if (patternArgs.length === 1) {
        port = 0
        channel = parseInt(patternArgs[0], 10) || 0
      } else if (patternArgs.length === 2) {
        channel = parseInt(patternArgs[0], 10) || 0
        port = parseInt(patternArgs[1], 10) || 0
      } else {
        port = 0
        channel = 0
      }
      // Listen to given midi port/channel, create appropriate event and call player.play()
      midi.listen(port, channel, player.id+player._num, (note, velocity) => {
        if (velocity === undefined) { // Note off
          releaseNotes(player, e => e._midiNote === note)
          if (!!player._shouldUnlisten && allStopped(player)) {
            midi.stopListening(port, channel, player.id+player._num) // Nothing left playing, cleanup listener
          }
          return
        }
        if (player._shouldUnlisten) { return } // Dont play any new events if player is being cleaned up!
        // A live note must be anchored to the real now, not to metronome.timeNow(), which is the
        // audio clock as sampled by the last animation frame (metronome.update, called from the rAF
        // tick). A key/midi event arrives BETWEEN frames, so that reading is stale by up to a frame
        // and puts _time behind audio.currentTime - ie behind the block the render thread is on.
        // Native source nodes shrug that off (start(when) in the past means start now), but it left
        // worklet oscillators gating their start param in an already rendered block. No lookahead is
        // added: a live instrument should stay as immediate as it is.
        let now = system.timeNow()
        let currentCount = metronome.beatTime(now)
        let lastBeat = metronome.lastBeat()
        let event = {
          _midiNote: note,
          value: 0,
          dur: 1,
          vel: velocity,
          _time: now,
          count: currentCount,
          idx: lastBeat.count,
          beat: Object.assign({}, lastBeat, {count: currentCount, time: now}),
        }
        applyMapping(event, note, mapping)
        let oct = event.oct
        event.sound = event.value
        event = combineOverrides(event, baseParams)
        event.oct = oct // Ignore base params and use the midi supplied octave
        event.vel = velocity // Ignore base params (whose default vel would clobber it) and use the midi supplied velocity
        event = applyOverrides(event, params) // A vel= or vel*= on the player line still applies on top
        let events = player.processEvents([event])
        events.forEach(e => { e._noteOff = () => {} }) // Default _noteOff callback does nothing
        player.play(events)
      })
      // Disconnect midi listener on player cleanup
      if (player.destroy !== undefined) { throw `Player ${player.id} already has destroy?!` }
      player.destroy = (replaced) => {
        player._shouldUnlisten = true
        // Held notes are only released when the player is really going away (stop all, or its line
        // deleted): on a code re-run the events are handed to the replacement player, whose listener
        // still matches the note off, so a note held across the re-run is not cut
        if (!replaced) { releaseNotes(player) }
        if (allStopped(player)) {
          midi.stopListening(port, channel, player.id+player._num)
        }
      }
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual, msg) => {
    if (expected !== actual) { console.trace(`Assertion failed.\n>>Expected: ${expected}\n>>Actual: ${actual}${msg?'\n'+msg:''}`) }
  }
  let {newOverride} = require('player/override-params')
  let testPlayer = (id) => {
    let player = {id: id, _num: 0, events: []}
    player.processEvents = (es) => es
    player.play = (es) => es.forEach(e => player.events.push(e))
    return player
  }
  // Stub out the midi module so a note can be played without any hardware (and without the real
  // listen asking for midi access)
  let realListen = midi.listen, realStop = midi.stopListening
  let note = (id, params, baseParams, noteNumber, velocity) => {
    let captured
    midi.listen = (port, channel, listenerId, cb) => { captured = cb }
    midi.stopListening = () => {}
    try {
      let player = testPlayer(id)
      midiPlayer('0', params, player, baseParams)
      captured(noteNumber, velocity)
      return player.events[player.events.length-1]
    } finally {
      midi.listen = realListen
      midi.stopListening = realStop
    }
  }

  // The base params' default vel must not clobber the velocity the note was played at
  assert(0.25, note('mtest1', {}, {vel:3/4}, 60, 0.25).vel, 'the midi velocity survived the base params')
  // A vel on the player's own line still applies, on top of the midi velocity
  assert(0.5, note('mtest2', {vel:newOverride(2, (l,r) => l*r)}, {vel:3/4}, 60, 0.25).vel, 'vel*= scales the midi velocity')
  assert(1, note('mtest3', {vel:newOverride(1)}, {vel:3/4}, 60, 0.25).vel, 'vel= overrides the midi velocity')
  // The octave restore is unchanged
  assert(4, note('mtest4', {}, {vel:3/4, oct:9}, 60, 1).oct, 'the midi note supplies the octave, not the base params')
  assert(0, note('mtest5', {}, {vel:3/4}, 60, 1).value, 'middle c is chromatic 0')

  console.log('Midi player tests complete')
  }

  return midiPlayer
})
