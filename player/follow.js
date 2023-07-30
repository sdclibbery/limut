'use strict';
define(function(require) {
  let players = require('player/players')
  let {combineOverrides,applyOverrides} = require('player/override-params')

  let followPlayer = (playerIdToFollow, params, player, baseParams) => {
    return (beat) => {
      let p = players.getById(playerIdToFollow)
      if (p === undefined) { return [] }
      let events = p.getEventsForBeat(beat)
      events = events.map(e => {
        // base params - the preset for the follow player
        // e - the event the follow player is following
        // params - the follow player's own event params
        e = combineOverrides(e, baseParams)
        return applyOverrides(e, params)
      })
      events.forEach(e => e.linenum = player.linenum)
      let overrides = players.overrides[player.id] || {}
      events = events.map(e => applyOverrides(e, overrides))
      return events
    }
  }

  return followPlayer
})
