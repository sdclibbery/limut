'use strict';
define(function(require) {
  var parsePattern = require('player/pattern');
  var parseParams = require('player/params');

  return (patternStr, paramsStr, defaultDur, player) => {
    let params = parseParams(paramsStr, player.dependsOn, player.id)
    let pattern = parsePattern(patternStr, params, defaultDur)
    return (beat) => {
      let eventsForBeat = pattern(beat.count, player)
      let events = eventsForBeat.map(event => {
        let eventToPlay = Object.assign({}, event, {sound: event.value, beat: beat})
        eventToPlay._time = beat.time + event._time*beat.duration
        return eventToPlay
      })
      return events
    }
  }
});
