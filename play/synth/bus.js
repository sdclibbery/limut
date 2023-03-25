'use strict'
define((require) => {
  var system = require('play/system')
  var metronome = require('metronome')
  let {evalMainParamFrame} = require('play/eval-audio-params')
  let destructor = require('play/destructor')
  let effects = require('play/effects/effects')
  let waveEffects = require('play/effects/wave-effects')

  let createBus = (busId, oldBus) => {
    let bus = { id: busId, _perFrame: [], destructor: destructor() }

    // Input and output
    if (oldBus) {
      // Transfer input mixer from the previous version of this bus
      bus.input = oldBus.input
      oldBus.destroy()
    } else {
      bus.input = system.audio.createGain()
    }

    // output
    bus.output = system.audio.createGain()
    system.mix(bus.output)
    bus.destructor.disconnect(bus.input, bus.output)
    
    // Created rest of bus later, when param overrides are available
    let stopped = false
    bus.createChain = (params) => {
      params._perFrame = bus._perFrame
      params._destructor = bus.destructor
      params.count = metronome.beatTime(metronome.timeNow())
      // effect chain
      effects(params, waveEffects(params, bus.input)).connect(bus.output)
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
        stopped = true
        bus._perFrame = []
        bus.destructor.destroy()
      }
    }

    return bus
  }

  return createBus
})