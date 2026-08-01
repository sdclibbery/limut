'use strict';
define(function(require) {
  var parseParams = require('player/params');
  let {applyOverride,applyOverrides,collapseOverrides} = require('player/override-params')
  let players = require('player/players')
  let pattern = require('pattern/pattern.js')
  let {evalParamFrame} = require('player/eval-param')
  let {mainParam} = require('player/sub-param')
  let consoleOut = require('console')

  // The pattern param, if set, supplies the pattern string in place of the one on the player line.
  // Like dur, it is needed before any events exist, so it is evaluated per frame against a synthetic event.
  let patternStrFromParams = (params, patternStr, count) => {
    if (params.pattern === undefined) { return patternStr }
    let p = mainParam(evalParamFrame(params.pattern, {idx:0, count:count}, count))
    if (p === undefined || p === '') { return patternStr }
    return ''+p
  }

  return (patternStr, paramsStr, player, baseParams) => {
    let defaultPatternStr = patternStr || '0'
    let params = parseParams(paramsStr, player.id)
    if (patternStr) {
      // The pattern on the player line sits between the preset and the line's own params, so it
      // overrides a pattern param from a preset, but is itself overridden by one on the line
      baseParams = Object.assign({}, baseParams, {pattern: patternStr})
    }
    params = applyOverrides(baseParams, params)
    params = collapseOverrides(params)
    return (beat) => {
      let ks = player.keepState
      let effectiveParams = params
      let overrides = players.overrides[player.id] || {}
      let overrideDur = overrides.dur
      let overridePattern = overrides.pattern
      if (overrideDur !== undefined || overridePattern !== undefined) {
        effectiveParams = Object.assign({}, params)
        if (overrideDur !== undefined) { effectiveParams.dur = applyOverride(effectiveParams, 'dur', overrideDur) }
        if (overridePattern !== undefined) { effectiveParams.pattern = applyOverride(effectiveParams, 'pattern', overridePattern) }
      }
      let effectivePatternStr = patternStrFromParams(effectiveParams, defaultPatternStr, beat.count)
      if (ks._pattern === undefined || ks._patternStr !== effectivePatternStr) { // Reparse pattern only when source has changed
        ks._patternStr = effectivePatternStr // Set first so a bad pattern is not retried (and reported) every beat
        try {
          ks._pattern = pattern(effectivePatternStr, effectiveParams)
        } catch (e) {
          ks._pattern = () => [] // A pattern param can go bad while playing, so keep going and pick up the next valid value
          consoleOut(`🔴 ${player.id} pattern: ${e}`)
        }
      }
      ks._pattern.params = effectiveParams // Always update the params
      let events = ks._pattern(beat.count)
      return events
    }
  }
});
