'use strict';
define(function(require) {
  var parseParams = require('player/params');
  var players = require('player/players')
  let {applyOverrides,collapseOverrides} = require('player/override-params')

  return (playerFactory, paramsStr, playerId, baseParams) => {
    let params = parseParams(paramsStr, playerId)
    params = applyOverrides(baseParams, params)
    params = collapseOverrides(params)

    let oldPlayer = players.getById(playerId)
    let player = playerFactory.create(playerId, oldPlayer)

    player.getEventsForBeat = () => []
    let played = false
    player.play = () => {
      if (played) { return }
      let overrides = players.overrides[playerId] || {}
      params = applyOverrides(params, overrides)
      player.start(params)
      played = true
    }
    player.currentEvent = () => []

    return player
  }
});
