'use strict'
define((require) => {
  var system = require('play/system')
  var metronome = require('metronome')
  let {evalMainParamFrame} = require('play/eval-audio-params')
  let destructor = require('play/destructor')
  let effects = require('play/effects/effects')
  let waveEffects = require('play/effects/wave-effects')

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
    bus.createChain = (params) => {
      params._perFrame = bus._perFrame
      params._destructor = bus.destructor
      params.count = metronome.beatTime(metronome.timeNow())
      // output
      bus.output = system.audio.createGain()
      system.mix(bus.output)
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
      effects(params, waveEffects(params, bus.crossfade)).connect(bus.output)
      bus.output.gain.cancelScheduledValues(0)
      evalMainParamFrame(bus.output.gain, params, 'amp', 1) // output amp
      // Per frame update
      system.add(metronome.timeNow(), state => {
        if (stopped) { return false }
        bus._perFrame.forEach(pf => pf(state))
        return true
      })
      // Cleanup
      bus.destroy = () => {
        fadeOut(bus.crossfade, () => {
          stopped = true
          bus._perFrame = []
          input.disconnect(bus.crossfade) // Only disconnect input from THIS bus as it may get transferred to another bus
          bus.destructor.destroy()
        })
      }
    }

    return bus
  }

  return createBus
})