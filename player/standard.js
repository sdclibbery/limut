'use strict';
define(function(require) {
  var parseParams = require('player/params');
  let {applyOverrides,collapseOverrides} = require('player/override-params')
  let pattern = require('pattern/pattern.js')

  return (patternStr, paramsStr, player, baseParams) => {
    let params = parseParams(paramsStr, player.id)
    params = applyOverrides(baseParams, params)
    params = collapseOverrides(params)
    return (beat) => {
      let ks = player.keepState
      if (ks._pattern === undefined || ks._patternStr !== patternStr) { // Reparse pattern only when source has changed
        ks._pattern = pattern(patternStr, params)
        ks._patternStr = patternStr
      }
      ks._pattern.params = params // Always update the params
      let events = ks._pattern(beat.count)
      return events
    }
  }
});
