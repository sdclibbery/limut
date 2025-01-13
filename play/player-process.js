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

  let fadeIn = (node, fadeTime) => {
    node.gain.cancelScheduledValues(0)
    node.gain.setValueAtTime(0, system.timeNow())
    node.gain.linearRampToValueAtTime(1, system.timeNow()+fadeTime)
  }
  let fadeOut = (node, destroy, fadeTime) => {
    node.gain.cancelScheduledValues(0)
    node.gain.setValueAtTime(1, system.timeNow())
    node.gain.linearRampToValueAtTime(0, system.timeNow()+fadeTime)
    setTimeout(destroy, fadeTime*1000)
  }

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

    // Destruction
    process.destroy = () => {
      fadeOut(process.fadeOutGain, process.cleanup, process.destroyWait+3)
    }
    process.cleanup = () => {
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
    process.fadeOutGain = system.audio.createGain()
    connect(process.chain, process.fadeOutGain, process.destructor)
    process.fadeOutGain.connect(bus._input)
    process.destructor.disconnect(process.fadeOutGain)

    // Input via fade in
    process.chainInput = system.audio.createGain()
    connect(process.chainInput, process.chain, process.destructor)
    fadeIn(process.chainInput, 0.1)

    return process
}

  return createProcessChain
})