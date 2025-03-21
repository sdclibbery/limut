'use strict'
define((require) => {
  var system = require('play/system')
  let {evalParamEvent} = require('player/eval-param')
  var metronome = require('metronome')
  let {evalMainParamEvent} = require('play/eval-audio-params')
  let destructor = require('play/destructor')
  let players = require('player/players')
  let consoleOut = require('console')
  let {connect} = require('play/nodes/connect')

  let fadeIn = (node, fadeTime) => {
    node.gain.value = 0
    node.gain.cancelScheduledValues(0)
    node.gain.setValueAtTime(0, 0)
    node.gain.linearRampToValueAtTime(1, system.timeNow()+fadeTime)
  }
  let fadeOut = (node, destroy, fadeTime) => {
    node.gain.cancelScheduledValues(0)
    node.gain.setValueAtTime(1, 0)
    node.gain.linearRampToValueAtTime(0, system.timeNow()+fadeTime)
    setTimeout(destroy, fadeTime*1000)
  }

  let id = 0
  let createPlayerFxChain = (eventParams, connectToAudioDest) => {
    // Setup for continuous running
    let fx = {
      _perFrame: [],
      destructor: destructor(),
      stopped: false,
      destroyWait: 0.1,
      id: id++,
    }
    let params = Object.assign({}, eventParams)
    params._perFrame = fx._perFrame
    params._destructor = fx.destructor
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
      if (fx.stopped) { return false }
      fx._perFrame.forEach(pf => {
        return pf(state)
    })
      return true
    })

    // Destruction
    fx.destroy = () => {
      fadeOut(fx.fadeOutGain, fx.cleanup, fx.destroyWait+3)
    }
    fx.cleanup = () => {
      fx.stopped = true
      fx._perFrame = []
      fx.destructor.destroy()
    }
    
    // Create the chain
    fx.chain = evalParamEvent(params.fx, params) // Get the Audionode fx chain

    // Output
    fx.fadeOutGain = system.audio.createGain()
    connect(fx.chain, fx.fadeOutGain, fx.destructor)
    if (connectToAudioDest) {
      system.mix(fx.fadeOutGain)
    } else {
      let busPlayerId = evalMainParamEvent(params, 'bus')
      if (!busPlayerId) { busPlayerId = 'main' } // Default to main bus if not specified
      let bus = players.getById(busPlayerId)
      if (!bus || !bus._input) {
        consoleOut(`🟠 Player ${params._player.id} fx failed to connect to destination bus ${busPlayerId}`)
        return
      }
      fx.fadeOutGain.connect(bus._input)
    }
    fx.destructor.disconnect(fx.fadeOutGain)

    // Input via fade in
    fx.chainInput = system.audio.createGain()
    fadeIn(fx.chainInput, 0.1)
    connect(fx.chainInput, fx.chain, fx.destructor)

    return fx
}

  return createPlayerFxChain
})