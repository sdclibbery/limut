'use strict';
define(function(require) {
  var parsePattern = require('player/pattern');
  var parseParams = require('player/params');
  var followPlayer = require('player/follow');

  let splitOnAll = (str, ch) => {
    if (!str) { return [] }
    return str.split(ch).map(x => x.trim()).filter(x => x!=ch)
  }

  let splitOnFirst = (str, ch) => {
    if (!str) { return [] }
    let parts = splitOnAll(str, ch)
    return [parts[0], parts.slice(1).join()]
  }

  return (command, defaultDur) => {
    let [patternStr, paramsStr] = splitOnFirst(command, ',').map(s => s.trim())
    let params = parseParams(paramsStr)
    if (patternStr.endsWith('//')) { // all params commented out
      params = ''
      patternStr = patternStr.slice(0, -2)
    }
    if (patternStr.startsWith('follow')) { return followPlayer(patternStr.slice(6).trim(), params) }
    let pattern = parsePattern(patternStr, params, defaultDur)
    return (beat) => {
      let eventsForBeat = pattern(beat.count)
      return eventsForBeat.map(event => {
        let eventToPlay = Object.assign({}, event, {sound: event.value, beat: beat})
        eventToPlay.time = beat.time + event.time*beat.duration
        return eventToPlay
      })
    }
  }
});
