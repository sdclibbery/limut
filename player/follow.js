'use strict';
define(function(require) {
  let players = require('player/players')
  let {combineOverrides,applyOverrides} = require('player/override-params')

  let followPlayer = (playerIdToFollow, params, player, baseParams) => {
    return (beat) => {
      let p = players.getById(playerIdToFollow)
      if (p === undefined) { return [] }
      let events = p.getEventsForBeatRaw(beat)
      events = events.map(e => {
        // base params - the preset for the follow player
        // e - the event the follow player is following
        // params - the follow player's own event params
        e = combineOverrides(e, baseParams)
        e = applyOverrides(e, params)
        return e
      })
      return events
    }
  }

  return followPlayer
})
