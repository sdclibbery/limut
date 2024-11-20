'use strict';
define(function (require) {
  let system = require('play/system');
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let {connect} = require('play/node-connect')
  let players = require('player/players')
  let destructor = require('play/destructor')
  let {evalParamEvent} = require('player/eval-param')

  return (params) => {
    params._destructor = destructor() // Setup event destructor and duration
    let duration = Math.max(0.01, evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 0.25, 'b'), 'b'))
    duration *= evalMainParamEvent(params, "long", 1)
    duration *= params.beat.duration
    params.endTime = params._time + duration
    params._disconnectTime = 0.1+(params.endTime - system.audio.currentTime)
    let chain = evalParamEvent(params.playchain, params) // Audionode chain
    let busId = params.bus
    if (!busId) { busId = 'main' } // Default to main bus if not specified
    let bus = players.getById(busId)
    if (!bus || !bus._input) { // Do nothing if bus not present
      consoleOut(`🟠 Player ${playerId} failed to connect to destination bus ${busId}`)
    }
    connect(chain, bus._input, params._destructor, {dont_disconnect_r:true}) // Connect end of chain to bus
    setTimeout( // Cleanup
      () => params._destructor.destroy(),
      params._disconnectTime*1000
    )
  }
});
