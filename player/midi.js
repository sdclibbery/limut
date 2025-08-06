'use strict';
define(function(require) {
  let midi = require('midi')
  let metronome = require('metronome')
  let {combineOverrides,applyOverrides} = require('player/override-params')
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
        port = parseInt(patternArgs[0], 10) || 0
        channel = parseInt(patternArgs[1], 10) || 0
      } else {
        port = 0
        channel = 0
      }
      // Listen to given midi port/channel, create appropriate event and call player.play()
      midi.listen(port, channel, player.id, (note, velocity) => {
        if (velocity === undefined) { // Note off
          for (let k in player.events) {
            let e = player.events[k]
            if (!!e._noteOff && e._midiNote === note) {
              e._noteOff() // Call note off callback so sustain envelopes can move to release phase
            }
          }
          return
        }
        let event = {
          _midiNote: note,
          value: 0,
          dur: 1,
          vel: velocity,
          _time: metronome.timeNow(),
          count: metronome.lastBeat().count,
          idx: metronome.lastBeat().count,
          beat: metronome.lastBeat(),
        }
        applyMapping(event, note, mapping)
        let oct = event.oct
        event.sound = event.value
        event = combineOverrides(event, baseParams)
        event.oct = oct // Ignore base params and use the midi supplied octave
        event = applyOverrides(event, params)
        let events = player.processEvents([event])
        events.forEach(e => { e._noteOff = () => {} }) // Default _noteOff callback does nothing
        player.play(events)
      })
      // Disconnect midi listener on player cleanup
      if (player.destroy !== undefined) { throw `Player ${player.id} already has destroy?!` }
      player.destroy = () => {
        midi.stopListening(port, channel, player.id)
      }
  }

  return midiPlayer
})
