'use strict';
define(function(require) {
  let players = require('player/players')
  let {combineOverrides,applyOverrides} = require('player/override-params')
  let {evalParamFrame} = require('player/eval-param')
  let {mainParam} = require('player/sub-param')

  let followPlayer = (playerIdToFollow, params, player, baseParams) => {
    return (beat) => {
      let p = players.getById(playerIdToFollow)
      if (p === undefined) { return [] }
      let events = p.getEventsForBeatRaw(beat)
      events = events.filter(e => mainParam(evalParamFrame(mainParam(evalParamFrame(e.amp, e, e.count), 0))) > 0) // Discard non playing events BEFORE overriding params
      events = events.map(e => {
        // base params - the preset for the follow player
        // e - the event the follow player is following
        // params - the follow player's own event params
        e = combineOverrides(e, baseParams)
        return applyOverrides(e, params)
      })
      return events
    }
  }

  return followPlayer
})
