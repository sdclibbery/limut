'use strict';
define(function(require) {
  var parseParams = require('player/params');
  var players = require('player/players')
  let {applyOverrides,collapseOverrides} = require('player/override-params')

  return (playerFactory, paramsStr, playerId, baseParams, transferFxChain, transferEvents) => {
    let params = parseParams(paramsStr, playerId)
    params = applyOverrides(baseParams, params)
    params = collapseOverrides(params)

    let oldPlayer = players.getById(playerId)
    let player = playerFactory.create(playerId, oldPlayer)
    player._fx = transferFxChain
    player.events = transferEvents

    player.getEventsForBeat = () => []
    // A continuous player reads its overrides exactly once, and the params it latches decide its whole
    // topology (for a bus, whether it has an fx chain at all). So it must not latch while a code update
    // is still parsing, or while a stop is clearing the overrides out from under it.
    let started = false
    let latchAndStart = () => {
      if (started) { return }
      let overrides = players.overrides[playerId] || {}
      params = applyOverrides(params, overrides)
      params._player = player
      player.start(params)
      started = true
    }
    player.play = () => {
      if (players.updating) { return } // startIfPending starts it as soon as the update has finished parsing
      latchAndStart()
    }
    player.startIfPending = latchAndStart // Called at the end of a code update, so it is live before the next beat
    player.cancelStart = () => { started = true } // Abandon a start that never happened (on stop); a no-op if already started
    player.currentEvent = () => [params]

    return player
  }
});
