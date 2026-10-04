'use strict';
define(function(require) {
  let midi = require('midi')
  let metronome = require('metronome')
  let system = require('play/system')
  let {combineOverrides,applyOverrides} = require('player/override-params')
  let {releaseNotes,allStopped} = require('player/live-notes')
  let scale = require('music/scale')
  let avw2 = require('functions/avw2')

  let midiNoteToOctave = (note) => {
    return Math.floor(note / 12) - 1
  }
  let midiNoteToChromatic = (note) => {
    return note % 12
  }

  // Degree 0 is A, not C, so the black key below the root (G#) can play a minor key's leading note
  let degreeZero = 57 // The A below middle C
  let whiteDegree = [0,0,1,2,2,3,3,4,5,5,6,6] // Semitones above A -> degree of the white note at or below it
  let whiteSharp  = [0,1,0,0,1,0,1,0,0,1,0,1] // ...and whether it is the black note just above that white one

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
      // Degrees run on continuously, so the A above is degree 7 and degreeToFreq does the
      // octave wrapping itself (just as the keyboard player's rows do). Neither oct nor scale is
      // set, so the player's own oct=/scale= and the preset base params still apply.
      let offset = note - degreeZero
      let octave = Math.floor(offset/12)
      let chromatic = offset - octave*12
      event.value = octave*7 + whiteDegree[chromatic]
      if (whiteSharp[chromatic]) { event.sharp = 1 }
    }
  }

  let parseArgs = (patternStr) => {
    let args = patternStr.split(/\s+/)
      .map(arg => arg.trim())
      .filter(arg => arg !== '')
      .map(arg => !isNaN(parseInt(arg,10)) ? parseInt(arg,10) : arg)
    let mapping = 'scale'
    if (typeof args[0] === 'string')  {
      mapping = args[0]
      args = args.slice(1)
    }
    return { mapping: mapping, args: args }
  }

  // listen(cb) must call cb(note, velocity, port), with an undefined velocity for a note off
  let livePlayer = (mapping, channel, params, player, baseParams, listen, stopListening, strikeVel) => {
      listen((note, velocity, port) => {
        if (velocity === undefined) { // Note off
          releaseNotes(player, e => e._midiNote === note)
          if (!!player._shouldUnlisten && allStopped(player)) {
            stopListening() // Nothing left playing, cleanup listener
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
          vel: strikeVel(velocity, port),
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
        event.vel = strikeVel(velocity, port) // Ignore base params (whose default vel would clobber it) and use the midi supplied velocity
        // Aftertouch is a separate continuous modulation source, as it is on any synth: vel stays the
        // latched strike velocity and the live pressure arrives on a param of its own. Set after the
        // base params, so a preset's press=0 default is overridden, and before the player line's
        // overrides, so a press= or press*= still composes on top - the same ordering the gamepad
        // player uses for its lt:/rt: params.
        let ownEvents
        let pressure = midi.getPressure(port, channel, note)
        let press = () => {
          // Frozen once the voice is releasing: the note off zeroes the device's pressure, and the
          // release tail must not go with it. _stopping is set on every release path (live-notes.js),
          // including a code re-run, where the events are handed on to the replacement player.
          if (!ownEvents || !ownEvents.some(e => e._stopping)) { pressure = midi.getPressure(port, channel, note) }
          return pressure
        }
        press.interval = 'frame' // Carries up through this.press into amp/lpf/..., so they get a per-frame updater
        press.isNonTemporal = true // External input, so it cannot be re-evaluated at an arbitrary beat
        event.press = press
        event = applyOverrides(event, params) // A vel= or vel*= on the player line still applies on top
        let events = player.processEvents([event])
        events.forEach(e => { e._noteOff = () => {} }) // Default _noteOff callback does nothing
        ownEvents = events
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
          stopListening()
        }
      }
  }


  let midiPlayer = (patternStr, params, player, baseParams) => {
    let {mapping, args} = parseArgs(patternStr)
    let port = 0, channel = 0
    if (args.length === 1) {
      channel = parseInt(args[0], 10) || 0
    } else if (args.length === 2) {
      channel = parseInt(args[0], 10) || 0
      port = parseInt(args[1], 10) || 0
    }
    let id = player.id+player._num
    livePlayer(mapping, channel, params, player, baseParams,
      (cb) => midi.listen(port, channel, id, (note, velocity) => cb(note, velocity, port)),
      () => midi.stopListening(port, channel, id),
      (velocity) => velocity)
  }

  // The keytar, found by name wherever it is plugged in. The softest strike still sounds at half vel,
  // and the neck slider scales vel live, so it reaches held notes too
  let avw2Player = (patternStr, params, player, baseParams) => {
    let {mapping, args} = parseArgs(patternStr)
    let channel = typeof args[0] === 'number' ? args[0] : avw2.keyChannel
    let id = player.id+player._num
    let slider = avw2.controls.s1
    livePlayer(mapping, channel, params, player, baseParams,
      (cb) => midi.listenDevice(avw2.deviceNames, channel, id, cb),
      () => midi.stopListeningDevice(id),
      (velocity, port) => {
        let strike = 1/2 + velocity/2
        let vel = () => strike * midi.getValue(port, avw2.controlChannel, slider.control, undefined, slider.default)
        vel.interval = 'frame'
        vel.isNonTemporal = true
        return vel
      })
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

  // Default mapping: the white notes are the scale degrees, from degree 0 at the A below middle C
  assert(0, note('0', {}, {}, 57, 1).value, 'the a below middle c is degree 0')
  assert(undefined, note('0', {}, {}, 57, 1).sharp, 'a white note is not sharpened')
  assert(undefined, note('0', {}, {}, 57, 1).scale, 'the scale is left as the player has it')
  assert(1, note('0', {}, {}, 59, 1).value, 'b is degree 1')
  assert(2, note('0', {}, {}, 60, 1).value, 'middle c is degree 2')
  assert(6, note('0', {}, {}, 67, 1).value, 'g is degree 6')
  assert(7, note('0', {}, {}, 69, 1).value, 'the a above is degree 7')
  assert(-1, note('0', {}, {}, 55, 1).value, 'the g below is degree -1')
  assert(-7, note('0', {}, {}, 45, 1).value, 'the a below is degree -7')
  // Black notes sharpen the white note below them
  assert(-1, note('0', {}, {}, 56, 1).value, 'g sharp below the root plays that g...')
  assert(1, note('0', {}, {}, 56, 1).sharp, '...sharpened a semitone: the leading note')
  assert(0, note('0', {}, {}, 58, 1).value, 'a sharp plays a...')
  assert(1, note('0', {}, {}, 58, 1).sharp, '...sharpened a semitone')
  assert(2, note('0', {}, {}, 61, 1).value, 'c sharp plays c...')
  assert(1, note('0', {}, {}, 61, 1).sharp, '...sharpened a semitone')
  assert(undefined, note('0', {}, {}, 60, 1).sharp, 'c, straight after b, is not a black note')
  assert(1, note('0', {}, {sharp:0}, 61, 1).sharp, 'a base param sharp does not clobber a black note')
  assert(2, note('0', {sharp:newOverride(2)}, {}, 61, 1).sharp, 'sharp= on the player line still wins')
  // The midi note no longer supplies the octave, so the player's own oct applies
  assert(9, note('0', {}, {oct:9}, 57, 1).oct, 'the base params supply the octave')
  assert(undefined, note('0', {}, {}, 57, 1).oct, 'no octave is forced onto the event')

  // The absolute chromatic mapping is still there under 'abs'
  assert(0, note('abs 0', {}, {vel:3/4}, 60, 1).value, 'middle c is chromatic 0')
  assert(8, note('abs 0', {}, {vel:3/4}, 68, 1).value, 'a midi note maps to the same chromatic note')
  assert('chromatic', note('abs 0', {}, {vel:3/4}, 60, 1).scale, 'abs forces the chromatic scale')
  assert(4, note('abs 0', {}, {vel:3/4, oct:9}, 60, 1).oct, 'the midi note supplies the octave, not the base params')

  // And the percussion mapping is unchanged
  assert('X', note('perc 0', {}, {}, 36, 1).value, 'midi note 36 is a heavy kick')
  assert('-', note('perc 0', {}, {}, 99, 1).value, 'an unmapped percussion note is a hat')

  // Aftertouch arrives as its own live param, leaving the strike velocity on vel alone
  {
    let {evalParamFrame} = require('player/eval-param')
    let realGetPressure = midi.getPressure
    let stubPressure = 0
    let play = (id, params) => {
      let player = testPlayer(id)
      let captured
      midi.listen = (port, channel, listenerId, cb) => { captured = cb }
      midi.stopListening = () => {}
      midi.getPressure = () => stubPressure
      midiPlayer('1', params, player, {vel:3/4, press:0})
      captured(60, 0.25)
      return player.events[player.events.length-1]
    }
    try {
      let e = play('mtestpress', {})
      assert(0.25, e.vel, 'vel is still the latched strike velocity')
      assert('function', typeof e.press, 'press is a live value')
      assert('frame', e.press.interval, 'evaluated every frame, so this.press reaches the audio params')
      assert(true, e.press.isNonTemporal, 'external input, so it cannot be evalled at an arbitrary beat')
      assert(0, e.press(), 'no pressure yet')
      stubPressure = 1/2
      assert(1/2, e.press(), 'and it tracks the device')
      e._stopping = true // As every release path marks it (live-notes.js)
      stubPressure = 0 // The note off zeroes the device pressure
      assert(1/2, e.press(), 'a releasing voice holds the pressure it ended on')

      stubPressure = 1/4 // A press= or press*= on the player line still composes with the live value
      let scaled = play('mtestpress2', {press:newOverride(2, (l,r) => l*r)})
      assert(1/2, evalParamFrame(scaled.press, scaled, 0))
      stubPressure = 1/3
      assert(2/3, evalParamFrame(scaled.press, scaled, 1), 'and stays live')
      let wrapped = evalParamFrame(scaled.press, scaled, 2, {withInterval:true})
      assert('frame', wrapped.interval, 'the override keeps the frame interval, so it is still updated per frame')
      assert(2/3, wrapped.value)
      assert(1, evalParamFrame(play('mtestpress3', {press:newOverride(1)}).press, {count:0}, 0), 'press= replaces it')
    } finally {
      midi.listen = realListen
      midi.stopListening = realStop
      midi.getPressure = realGetPressure
    }
  }

  { // The keytar player: a floor under the velocity, scaled live by the neck slider
    let {evalParamFrame} = require('player/eval-param')
    let real = {listenDevice: midi.listenDevice, stopListeningDevice: midi.stopListeningDevice, getValue: midi.getValue}
    let slider, listenChannel, sliderChannel
    let play = (id, params, velocity, patternStr) => {
      let player = testPlayer(id)
      let captured
      midi.listenDevice = (matcher, channel, listenerId, cb) => { captured = cb; listenChannel = channel }
      midi.stopListeningDevice = () => {}
      midi.getValue = (port, channel, control, note, dflt) => { sliderChannel = channel; return slider === undefined ? dflt : slider }
      avw2Player(patternStr || '', params, player, {vel:3/4, press:0})
      captured(60, velocity, 2)
      return player.events[player.events.length-1]
    }
    try {
      slider = undefined
      assert(1/2, play('atest1', {}, 0).vel(), 'the softest strike is half vel')
      assert(1, play('atest2', {}, 1).vel(), 'the hardest is full')
      let e = play('atest3', {}, 1/2)
      assert(3/4, e.vel(), 'linear in between, and the unmoved slider reads full')
      assert('frame', e.vel.interval, 'evaluated every frame')
      assert(true, e.vel.isNonTemporal)
      slider = 1/2
      assert(3/8, e.vel(), 'the slider scales a held note')
      assert(3/4, evalParamFrame(play('atest4', {vel:newOverride(2, (l,r) => l*r)}, 1/2).vel, {count:0}, 0), 'vel*= still applies')
      assert(1, evalParamFrame(play('atest5', {vel:newOverride(1)}, 1/2).vel, {count:0}, 0), 'vel= replaces it')
      play('atest6', {}, 1)
      assert(1, listenChannel, 'the keys are on channel 1 by default')
      play('atest7', {}, 1, '0')
      assert(0, listenChannel, 'avw2 0 picks channel 0')
      play('atest8', {}, 1, 'abs 5')
      assert(5, listenChannel, 'a channel after the mapping')
      play('atest9', {}, 1, '5').vel()
      assert(0, sliderChannel, 'the slider is read on the control channel, whatever the key channel')
    } finally {
      Object.assign(midi, real)
    }
  }

  console.log('Midi player tests complete')
  }

  return { midiPlayer: midiPlayer, avw2Player: avw2Player }
})
