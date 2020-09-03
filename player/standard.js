'use strict';
define(function(require) {
  var parsePattern = require('player/pattern');
  var parseParams = require('player/params');

  return (patternStr, paramsStr, defaultDur) => {
    let params = parseParams(paramsStr)
    let pattern = parsePattern(patternStr, params, defaultDur)
    return (beat) => {
      let eventsForBeat = pattern(beat.count)
      let events = eventsForBeat.map(event => {
        let eventToPlay = Object.assign({}, event, {sound: event.value, beat: beat})
        eventToPlay.time = beat.time + event.time*beat.duration
        return eventToPlay
      })
      return events
    }
  }
});
