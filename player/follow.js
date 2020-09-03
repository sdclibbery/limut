'use strict';
define(function(require) {
  let players = require('player/players')
  let overrideParams = require('player/override-params')

  let followPlayer = (playerName, params) => {
    return (beat) => {
      let p = players.instances[playerName.toLowerCase()]
      if (p === undefined) { throw 'Follow player not found: '+playerName }
      let events = p.getEventsForBeat(beat)
      events.forEach(e => delete e.oct)
      return overrideParams(events, params)
    }
  }

  return followPlayer;
});
