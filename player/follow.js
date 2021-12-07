'use strict';
define(function(require) {
  let players = require('player/players')
  let overrideParams = require('player/override-params').overrideParams

  let followPlayer = (playerIdToFollow, params) => {
    return (beat) => {
      let p = players.instances[playerIdToFollow.toLowerCase()]
      if (p === undefined) { return [] }
      let events = p.getEventsForBeatBase(beat)
      return events.map(e => overrideParams(e, params))
    }
  }

  return followPlayer
})
