'use strict'
define((require) => {
  var system = require('play/system')
  var metronome = require('metronome')
  let {mainParam} = require('player/sub-param')
  let {evalMainParamFrame,evalMainParamEvent,evalSubParamEvent} = require('play/eval-audio-params')
  let destructor = require('play/destructor')
  let effects = require('play/effects/effects')
  let waveEffects = require('play/effects/wave-effects')
  let convolutionReverb = require('play/effects/convolutionReverb')
  let {mix} = require('play/effects/mix')
  let players = require('player/players')
  let consoleOut = require('console')

  let fadeTime = 0.1
  let fadeIn = (node) => {
    node.gain.cancelScheduledValues(0)
    node.gain.setValueAtTime(0, system.timeNow()) // Similar signal on both sides of the crossfade, so use a linear crossfade
    node.gain.linearRampToValueAtTime(1, system.timeNow()+fadeTime)
  }
  let fadeOut = (node, cleanup) => {
    node.gain.cancelScheduledValues(0)
    node.gain.setValueAtTime(1, system.timeNow())
    node.gain.linearRampToValueAtTime(0, system.timeNow()+fadeTime)
    setTimeout(cleanup, fadeTime*1000)
  }

  let reverb = (params, node) => {
    if (!mainParam(params.reverb, 0)) { return node }
    let duration = evalMainParamEvent(params, 'reverb', 1/2) * metronome.beatDuration()
    let curve = evalSubParamEvent(params, 'reverb', 'curve', 3)
    let rev = convolutionReverb(duration, curve)
    let boost = system.audio.createGain()
    boost.gain.value = 6 // Boost the wet signal else the whole bus sounds quieter with a reverb in
    node.connect(rev)
    rev.connect(boost)
    return mix(params, 'reverb', node, boost, 1/3)
  }

  let effectChain = (params, bus) => {
    return reverb(params, effects(params, waveEffects(params, bus.crossfade)))
  }

  let connectToDestination = (bus, params) => {
    if (bus.id === 'main') { // If this is the main bus, it must mix direct to system
      system.mix(bus.output)
      return
    }
    let destBusId = evalMainParamEvent(params, 'bus')
    if (!destBusId) { destBusId = 'main' } // Default to main bus if not specified
    let destBus = players.instances[destBusId]
    if (destBus && destBus._input) { // Do nothing if bus not present
      bus.output.connect(destBus._input)
    } else {
      consoleOut(`Bus ${bus.id} failed to connect to destination bus ${destBusId}`)
    }
  }

  let createBus = (busId, oldBus) => {
    let bus = {
      id: busId,
      oldBus: oldBus,
      _perFrame: [], destructor: destructor()
     }

    // Input
    let input
    if (bus.oldBus) {
      input = bus.oldBus._input // Copy the same input mixer from the previous version of this bus to allow crossfading
    }
    if (!input) {
      input = system.audio.createGain()
    }
    bus._input = input
    
    // Create rest of bus later, when param overrides are available
    let stopped = false
    bus.start = (params) => {
      params._perFrame = bus._perFrame
      params._destructor = bus.destructor
      params.count = metronome.beatTime(metronome.timeNow())
      // output
      bus.output = system.audio.createGain()
      connectToDestination(bus, params)
      bus.destructor.disconnect(bus.output)
      // crossfade
      bus.crossfade = system.audio.createGain() // Crossfade from old version of bus to new
      input.connect(bus.crossfade)
      bus.destructor.disconnect(bus.crossfade)
      if (bus.oldBus) {
        if (bus.oldBus.destroy) { bus.oldBus.destroy() } // Fade out old bus and destroy
        delete bus.oldBus
      }
      fadeIn(bus.crossfade)
      // effect chain
      effectChain(params, bus).connect(bus.output)
      bus.output.gain.cancelScheduledValues(0)
      evalMainParamFrame(bus.output.gain, params, 'amp', 1) // output amp
      // Per frame update
      system.add(metronome.timeNow(), state => {
        if (stopped) { return false }
        bus._perFrame.forEach(pf => pf(state))
        return true
      })
    }
    // Cleanup
    bus.destroy = () => {
      if (bus.oldBus) {
        if (bus.oldBus.destroy) { bus.oldBus.destroy() } // Fade out old bus and destroy
        delete bus.oldBus
      }
      if (bus.crossfade) {
        fadeOut(bus.crossfade, () => {
          stopped = true
          bus._perFrame = []
          input.disconnect(bus.crossfade) // Only disconnect input from THIS bus as it may get transferred to another bus
          bus.destructor.destroy()
        })
      } else {
        stopped = true
        bus._perFrame = []
        bus.destructor.destroy()
      }
    }
        
    return bus
  }

  return createBus
})