'use strict';
define(function(require) {
  var parseParams = require('player/params');
  let {applyOverride,applyOverrides,collapseOverrides} = require('player/override-params')
  let players = require('player/players')
  let pattern = require('pattern/pattern.js')

  return (patternStr, paramsStr, player, baseParams) => {
    let params = parseParams(paramsStr, player.id)
    params = applyOverrides(baseParams, params)
    params = collapseOverrides(params)
    return (beat) => {
      let ks = player.keepState
      let effectiveParams = params
      let overrideDur = (players.overrides[player.id] || {}).dur
      if (overrideDur !== undefined) {
        effectiveParams = Object.assign({}, params)
        effectiveParams.dur = applyOverride(effectiveParams, 'dur', overrideDur)
      }
      if (ks._pattern === undefined || ks._patternStr !== patternStr) { // Reparse pattern only when source has changed
        ks._pattern = pattern(patternStr, effectiveParams)
        ks._patternStr = patternStr
      }
      ks._pattern.params = effectiveParams // Always update the params
      let events = ks._pattern(beat.count)
      return events
    }
  }
});
