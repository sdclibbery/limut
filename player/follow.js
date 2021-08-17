'use strict';
define(function(require) {
  let players = require('player/players')
  let overrideParams = require('player/override-params').overrideParams

  let followPlayer = (playerName, params) => {
    return (beat) => {
      let p = players.instances[playerName.toLowerCase()]
      if (p === undefined) { return [] }
      let events = p.getEventsForBeatBase(beat)
      events.forEach(e => delete e.oct)
      return events.map(e => overrideParams(e, params))
    }
  }

  return followPlayer
})
