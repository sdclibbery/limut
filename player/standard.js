'use strict';
define(function(require) {
  var parsePattern = require('player/pattern');
  var parseParams = require('player/params');

  let splitOnAll = (str, ch) => {
    if (!str) { return [] }
    return str.split(ch).map(x => x.trim()).filter(x => x!=ch)
  }

  let splitOnFirst = (str, ch) => {
    if (!str) { return [] }
    let parts = splitOnAll(str, ch)
    return [parts[0], parts.slice(1).join()]
  }

  return (play) => (command) => {
    let [patternStr, paramsStr] = splitOnFirst(command, ',')
    let params = parseParams(paramsStr)
    let pattern = parsePattern(patternStr, params)
    return (beat) => {
      let eventsForBeat = pattern(beat.count)
      eventsForBeat.forEach(event => {
        let eventToPlay = Object.assign({}, event, {sound: event.value, beat: beat})
        eventToPlay.time = beat.time + event.time*beat.duration
        play(eventToPlay)
      })
    }
  }
});
