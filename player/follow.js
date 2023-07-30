'use strict';
define(function(require) {
  let players = require('player/players')
  let {combineOverrides,applyOverrides} = require('player/override-params')

  let followPlayer = (playerIdToFollow, params, baseParams) => {
    return (beat) => {
      let p = players.getById(playerIdToFollow)
      if (p === undefined) { return [] }
      let events = p.getEventsForBeatBase(beat)
      return events.map(e => {
        // Remove params that affect the event stream itself. Eg remove stutter, otherwise the follow player will 'double stutter'
        delete e.stutter
        delete e.delay
        delete e.swing
        // base params - the preset for the follow player
        // e - the event the follow player is following
        // params - the follow player's own event params
        e = combineOverrides(e, baseParams)
        return applyOverrides(e, params)
      })
    }
  }

  return followPlayer
})
