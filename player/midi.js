'use strict';
define(function(require) {
  let midi = require('midi')
  let metronome = require('metronome')
  let {combineOverrides,applyOverrides} = require('player/override-params')

  let applyMapping = (event, note, mapping) => {
    if (mapping === 'perc') {
      event.value = {
        35:'x', 36:'X', 37:'t', 38:'o', 39:'H', 40:'u', 41:'m', 42:'-', 43:'M',
        46:'o', 49:'#', 54:'S', 56:'T', 
      }[note] || '-'
    } else if (mapping === 'abs') {
      event.addc = note-60 // Not actually absolute; either need a new param or rescale to root/scale/oct
    } else {
      event.sharp = note-60 // Doesn't play well with add=() chords, will have to do a proper inverse mapping?
    }
  }

  let midiPlayer = (patternStr, params, player, baseParams) => {
      // parse pattern string to get port/channel
      let patternArgs = patternStr.split(/\s+/)
      let mapping = 'rel'
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
        let event = {
          value: 0,
          dur: 1,
          vel: velocity,
          _time: metronome.timeNow(),
          count: metronome.lastBeat().count,
          idx: metronome.lastBeat().count,
          beat: metronome.lastBeat(),
        }
        applyMapping(event, note, mapping)
        event.sound = event.value
        event = combineOverrides(event, baseParams)
        event = applyOverrides(event, params)
        player.play(player.processEvents([event]))
      })
      // Disconnect midi listener on player cleanup
      if (player.destroy !== undefined) { throw `Player ${player.id} already has destroy?!` }
      player.destroy = () => {
        midi.stopListening(port, channel, player.id)
      }
  }

  return midiPlayer
})
