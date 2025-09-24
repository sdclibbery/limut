'use strict';
define(function(require) {
  var parseParams = require('player/params');
  var players = require('player/players')
  let {applyOverrides,collapseOverrides} = require('player/override-params')

  return (playerFactory, paramsStr, playerId, baseParams, transferFxChain) => {
    let params = parseParams(paramsStr, playerId)
    params = applyOverrides(baseParams, params)
    params = collapseOverrides(params)

    let oldPlayer = players.getById(playerId)
    let player = playerFactory.create(playerId, oldPlayer)
    player._fx = transferFxChain

    player.getEventsForBeat = () => []
    let started = false
    player.play = () => {
      if (started) { return }
      let overrides = players.overrides[playerId] || {}
      params = applyOverrides(params, overrides)
      params._player = player
      player.start(params)
      started = true
    }
    player.currentEvent = () => [params]

    return player
  }
});
