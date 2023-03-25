'use strict'
define((require) => {
  var system = require('play/system')
  var metronome = require('metronome')
  let {evalMainParamFrame} = require('play/eval-audio-params')
  let destructor = require('play/destructor')
  let effects = require('play/effects/effects')
  let waveEffects = require('play/effects/wave-effects')

  let createBus = (busId, params, oldBus) => {
    let bus = { id: busId, _perFrame: [], destructor: destructor() }
    params._perFrame = bus._perFrame
    params._destructor = bus.destructor
    params.count = metronome.beatTime(metronome.timeNow())

    // Input and output
    if (oldBus) {
      // Transfer input mixer from the previous version of this bus
      bus.input = oldBus.input
      oldBus.destroy()
    } else {
      bus.input = system.audio.createGain()
    }
    bus.output = system.audio.createGain()
    system.mix(bus.output)
    bus.destructor.disconnect(bus.input, bus.output)

    // Per frame update
    system.add(metronome.timeNow(), state => {
      if (bus.stopped) { return false }
      bus._perFrame.forEach(pf => pf(state))
      return true
    })

    // Bus chain
    effects(params, waveEffects(params, bus.input)).connect(bus.output)
    bus.output.gain.cancelScheduledValues(0)
    evalMainParamFrame(bus.output.gain, params, 'amp', 1) // output amp

    // Cleanup
    bus.destroy = () => {
      bus.stopped = true
      bus._perFrame = []
      bus.destructor.destroy()
    }
    return bus
  }

  return createBus
})