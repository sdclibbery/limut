'use strict'
define((require) => {
  var system = require('play/system')
  let {evalParamEvent} = require('player/eval-param')
  var metronome = require('metronome')
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let destructor = require('play/destructor')
  let players = require('player/players')
  let consoleOut = require('console')
  let {connect} = require('play/node-connect')

  let createProcessChain = (eventParams) => {
    // Setup for continuous running
    let process = {
      _perFrame: [],
      destructor: destructor(),
      stopped: false,
      destroyWait: 0.1,
    }
    let params = Object.assign({}, eventParams)
    params._perFrame = process._perFrame
    params._destructor = process.destructor
    delete params.beat
    delete params.endTime
    let offset = 0
    Object.defineProperty(params, "count", { // Params must define count so that evalParamEvent works, but use a dynamic getter so we can give it the current time (this effectively forces all values to per-frame interval)
      get() { return offset + metronome.beatTime(metronome.timeNow()) },
      set(c) { offset = c - metronome.beatTime(metronome.timeNow()) },
    })
    Object.defineProperty(params, "idx", { // Also define idx to allow [] index timevar to sort of work
      get() { return metronome.beatTime(metronome.timeNow())%2 },
    })
    system.add(metronome.timeNow(), state => { // Per frame update
      if (process.stopped) { return false }
      process._perFrame.forEach(pf => pf(state))
      return true
    })

console.log('create', params._player.id)
    // Destruction
    process.destroy = () => {
console.log('destroy', params._player.id)
      setTimeout(() => process.cleanup(), process.destroyWait*1000)
    }
    process.cleanup = () => {
console.log('cleanup', params._player.id)
      process.stopped = true
      process._perFrame = []
      process.destructor.destroy()
    }
    
    // Create the chain
    process.chain = evalParamEvent(params.process, params) // Get the Audionode process chain

    // Output to bus
    let busPlayerId = evalMainParamEvent(params, 'bus')
    if (!busPlayerId) { busPlayerId = 'main' } // Default to main bus if not specified
    let bus = players.getById(busPlayerId)
    if (!bus || !bus._input) {
      consoleOut(`🟠 Player ${params._player.id} process failed to connect to destination bus ${busPlayerId}`)
      return
    }
    connect(process.chain, bus._input, process.destructor, {dont_disconnect_r:true})

    return process
}

  return createProcessChain
})