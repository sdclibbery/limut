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

  let middleC = 60
  let whiteDegree = [0,0,1,1,2,3,3,4,4,5,5,6] // Chromatic index -> degree of the white note at or below it
  let whiteSharp  = [0,1,0,1,0,0,1,0,1,0,1,0] // ...and whether it is the black note just above that white one

  let applyMapping = (event, note, mapping) => {
    if (mapping === 'perc') {
      event.value = {
        35:'x', 36:'X', 37:'t', 38:'o', 39:'H', 40:'u', 41:'m', 42:'-', 43:'M',
        46:'o', 49:'#', 54:'S', 56:'T', 
      }[note] || '-'
    } else if (mapping === 'abs') { // 'abs': absolute chromatic note value
      let root = scale.root || 0
      event.oct = midiNoteToOctave(note - root)
      let chromatic = midiNoteToChromatic(note - root) // Correct for root (key)
      event.value = chromatic
      event.scale = 'chromatic' // Force to chromatic scale
    } else { // 'scale': white notes play the scale degrees, black notes sharpen them
      // Degrees run on continuously, so the C above middle C is degree 7 and degreeToFreq does the
      // octave wrapping itself (just as the keyboard player's rows do). Neither oct nor scale is
      // set, so the player's own oct=/scale= and the preset base params still apply.
      let offset = note - middleC
      let octave = Math.floor(offset/12)
      let chromatic = offset - octave*12
      event.value = octave*7 + whiteDegree[chromatic]
      if (whiteSharp[chromatic]) { event.sharp = 1 }
    }
  }

  let midiPlayer = (patternStr, params, player, baseParams) => {
      // parse pattern string to get port/channel
      let patternArgs = patternStr.split(/\s+/)
      let mapping = 'scale'
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
        let sharp = event.sharp
        event.sound = event.value
        event = combineOverrides(event, baseParams)
        if (oct !== undefined) { event.oct = oct } // 'abs' supplies the octave, not the base params
        if (sharp !== undefined) { event.sharp = sharp } // A black note sharpens, over any base param default
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
  let noteId = 0
  let note = (patternStr, params, baseParams, noteNumber, velocity) => {
    let captured
    midi.listen = (port, channel, listenerId, cb) => { captured = cb }
    midi.stopListening = () => {}
    try {
      let player = testPlayer('mtest'+(noteId++)) // A fresh id each time: destroy throws if already set
      midiPlayer(patternStr, params, player, baseParams)
      captured(noteNumber, velocity)
      return player.events[player.events.length-1]
    } finally {
      midi.listen = realListen
      midi.stopListening = realStop
    }
  }

  // The base params' default vel must not clobber the velocity the note was played at
  assert(0.25, note('0', {}, {vel:3/4}, 60, 0.25).vel, 'the midi velocity survived the base params')
  // A vel on the player's own line still applies, on top of the midi velocity
  assert(0.5, note('0', {vel:newOverride(2, (l,r) => l*r)}, {vel:3/4}, 60, 0.25).vel, 'vel*= scales the midi velocity')
  assert(1, note('0', {vel:newOverride(1)}, {vel:3/4}, 60, 0.25).vel, 'vel= overrides the midi velocity')

  // Default mapping: the white notes are the scale degrees, from degree 0 at the central C
  assert(0, note('0', {}, {}, 60, 1).value, 'middle c is degree 0')
  assert(undefined, note('0', {}, {}, 60, 1).sharp, 'a white note is not sharpened')
  assert(undefined, note('0', {}, {}, 60, 1).scale, 'the scale is left as the player has it')
  assert(1, note('0', {}, {}, 62, 1).value, 'd is degree 1')
  assert(6, note('0', {}, {}, 71, 1).value, 'b is degree 6')
  assert(7, note('0', {}, {}, 72, 1).value, 'the c above is degree 7')
  assert(-2, note('0', {}, {}, 57, 1).value, 'the a below is degree -2')
  assert(-7, note('0', {}, {}, 48, 1).value, 'the c below is degree -7')
  // Black notes sharpen the white note below them
  assert(0, note('0', {}, {}, 61, 1).value, 'c sharp plays c...')
  assert(1, note('0', {}, {}, 61, 1).sharp, '...sharpened a semitone')
  assert(-2, note('0', {}, {}, 58, 1).value, 'a sharp below middle c plays that a...')
  assert(1, note('0', {}, {}, 58, 1).sharp, '...sharpened a semitone')
  assert(1, note('0', {}, {sharp:0}, 61, 1).sharp, 'a base param sharp does not clobber a black note')
  assert(2, note('0', {sharp:newOverride(2)}, {}, 61, 1).sharp, 'sharp= on the player line still wins')
  // The midi note no longer supplies the octave, so the player's own oct applies
  assert(9, note('0', {}, {oct:9}, 60, 1).oct, 'the base params supply the octave')
  assert(undefined, note('0', {}, {}, 60, 1).oct, 'no octave is forced onto the event')

  // The absolute chromatic mapping is still there under 'abs'
  assert(0, note('abs 0', {}, {vel:3/4}, 60, 1).value, 'middle c is chromatic 0')
  assert(8, note('abs 0', {}, {vel:3/4}, 68, 1).value, 'a midi note maps to the same chromatic note')
  assert('chromatic', note('abs 0', {}, {vel:3/4}, 60, 1).scale, 'abs forces the chromatic scale')
  assert(4, note('abs 0', {}, {vel:3/4, oct:9}, 60, 1).oct, 'the midi note supplies the octave, not the base params')

  // And the percussion mapping is unchanged
  assert('X', note('perc 0', {}, {}, 36, 1).value, 'midi note 36 is a heavy kick')
  assert('-', note('perc 0', {}, {}, 99, 1).value, 'an unmapped percussion note is a hat')

  console.log('Midi player tests complete')
  }

  return midiPlayer
})
