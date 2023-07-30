'use strict';
define(function(require) {
  var parseParams = require('player/params');
  let {applyOverrides,collapseOverrides} = require('player/override-params')
  let root = require('pattern/root.js')

  return (patternStr, paramsStr, player, baseParams) => {
    let params = parseParams(paramsStr, player.id)
    params = applyOverrides(baseParams, params)
    params = collapseOverrides(params)
    return (beat) => {
      let ks = player.keepState
      if (ks._pattern === undefined || ks._patternStr !== patternStr) { // Reparse pattern only when source has changed
        ks._pattern = root(patternStr, params)
        ks._patternStr = patternStr
      }
      let eventsForBeat = ks._pattern(beat.count)
      let events = eventsForBeat.map(event => {
        let eventToPlay = Object.assign({}, event, {sound: event.value, beat: beat})
        eventToPlay._time = beat.time + event._time*beat.duration
        return eventToPlay
      })
      return events
    }
  }
});
