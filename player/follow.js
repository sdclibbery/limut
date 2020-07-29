'use strict';
define(function(require) {
  let players = require('player/players')
  let evalParam = require('player/eval-param')

  return (playerName, params) => {
    return (beat) => {
      let p = players.instances[playerName.toLowerCase()]
      if (p === undefined) { throw 'Follow player not found: '+playerName }
      let events = p.getEventsForBeat(beat)
      return events.map(sourceEvent => {
        let event = Object.assign({}, sourceEvent)
        for (let k in params) {
          if (k != 'time' && k != 'delay' && k != 'value') {
            event[k] = evalParam(params[k], sourceEvent.idx, sourceEvent.count)
          }
        }
        return event
      })
    }
  }
});
