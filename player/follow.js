'use strict';
define(function(require) {
  let players = require('player/players')
  let applyOverrides = require('player/override-params').applyOverrides

  let followPlayer = (playerIdToFollow, params) => {
    return (beat) => {
      let p = players.instances[playerIdToFollow.toLowerCase()]
      if (p === undefined) { return [] }
      let events = p.getEventsForBeatBase(beat)
      return events.map(e => applyOverrides(e, params))
    }
  }

  return followPlayer
})
