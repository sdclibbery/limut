'use strict';
define(function(require) {
  var parsePattern = require('pattern/parse-pattern');
  var parseParams = require('player/params');
  let {applyOverrides,collapseOverrides} = require('player/override-params')

  return (patternStr, paramsStr, player, baseParams) => {
    let params = parseParams(paramsStr, player.id)
    params = applyOverrides(baseParams, params)
    params = collapseOverrides(params)
    let pattern = parsePattern(patternStr, params)
    return (beat, timingContext) => {
      let eventsForBeat = pattern(beat.count, timingContext)
      let events = eventsForBeat.map(event => {
        let eventToPlay = Object.assign({}, event, {sound: event.value, beat: beat})
        eventToPlay._time = beat.time + event._time*beat.duration
        return eventToPlay
      })
      return events
    }
  }
});
