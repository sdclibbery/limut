'use strict';
define(function(require) {
  var parseParams = require('player/params');
  var players = require('player/players')
  let {applyOverrides,collapseOverrides} = require('player/override-params')

  return (playerFactory, paramsStr, playerId, baseParams) => {
    let params = parseParams(paramsStr, playerId)
    params = applyOverrides(baseParams, params)
    params = collapseOverrides(params)
    let player = playerFactory.create(playerId, params, players.instances[playerId])
    player.getEventsForBeat = () => []
    player.play = () => {}
    player.currentEvent = () => []
    return player
  }
});
