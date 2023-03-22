'use strict'
define((require) => {
  var system = require('play/system')
  var metronome = require('metronome')
  let {evalMainParamFrame} = require('play/eval-audio-params')
  let effects = require('play/effects/effects')

  let createBus = (busId, params, oldBus) => {
    let bus = { id: busId, _perFrame: [] }
    params._perFrame = bus._perFrame
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

    // Per frame update
    system.add(metronome.timeNow(), state => {
      if (bus.stopped) { return false }
      bus._perFrame.forEach(pf => pf(state))
      return true
    })

    // Bus chain
    bus.input.gain.cancelScheduledValues(0)
    // effects(params, bus.input).connect(bus.output)
    bus.input.connect(bus.output)
    evalMainParamFrame(bus.output.gain, params, 'amp', 1) // output amp

    // Cleanup
    bus.destroy = () => {
      bus.stopped = true
      bus._perFrame = []
      bus.input.disconnect()
      bus.output.disconnect()
    }
    return bus
  }

  return createBus
})