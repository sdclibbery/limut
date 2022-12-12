'use strict';
define(function(require) {
  let players = require('player/players')
  let {combineOverrides,applyOverrides} = require('player/override-params')

  let followPlayer = (playerIdToFollow, params, baseParams) => {
    return (beat) => {
      let p = players.instances[playerIdToFollow.toLowerCase()]
      if (p === undefined) { return [] }
      let events = p.getEventsForBeatBase(beat)
      return events.map(e => {
        // base params - the preset for the follow player
        // e - the event the follow player is following
        // params - the follow player's own event params
        e = combineOverrides(baseParams, e)
        return applyOverrides(e, params)
      })
    }
  }

  return followPlayer
})
