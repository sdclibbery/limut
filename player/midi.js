'use strict';
define(function(require) {
  let {midiListen} = require('midi')
  let metronome = require('metronome')
  let {combineOverrides,applyOverrides} = require('player/override-params')

  let midiPlayer = (patternStr, params, player, baseParams) => {
      // parse pattern string to get port/channel
      let patternArgs = patternStr.split(/\s+/)
      let port, channel
      if (patternArgs.length === 1) {
        port = 0
        channel = parseInt(patternArgs[0], 10) || 0
      } else if (patternArgs.length === 2) {
        port = parseInt(patternArgs[0], 10) || 0
        channel = parseInt(patternArgs[1], 10) || 0
      }
      // Listen to given midi port/channel, create appropriate event and call player.play()
      midiListen(port, channel, (note, velocity) => {
        let event = {
          value: note-60, // if channel 9, convert to percussion samples, else midi to scale
          dur: 1,
          vel: velocity,
          // loud: velocity,
          _time: metronome.timeNow(),
          count: metronome.lastBeat().count,
          idx: metronome.lastBeat().count,
          beat: metronome.lastBeat(),
        }
        event.sound = event.value
        event = combineOverrides(event, baseParams)
        event = applyOverrides(event, params)
        player.play(player.processEvents([event]))
      })
      // !!! Need to disconnect midi listener on player cleanup
  }

  return midiPlayer
})
