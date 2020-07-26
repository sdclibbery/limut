'use strict';
define(function(require) {
  let players = require('player/players')

  return (playerName, params) => {
    return (beat) => {
      let p = players.instances[playerName.toLowerCase()]
      if (p === undefined) { throw 'Follow player not found: '+playerName }
      let events = p.getEventsForBeat(beat)
      return events.map(event => Object.assign({}, event, params))
    }
  }
});
