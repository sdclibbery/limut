'use strict'
define((require) => {
  var system = require('play/system')
  let {evalMainParamFrame} = require('play/eval-audio-params')

  let createBus = (busId, params, oldBus) => {
    let bus = { id: busId }
    // In and out gains
    if (oldBus) {
      // Transfer input mixer from the previous version of this bus
      oldBus.input.disconnect()
      bus.input = oldBus.input
    } else {
      bus.input = system.audio.createGain()
    }
    bus.output = system.audio.createGain()
    // Bus chain
    evalMainParamFrame(bus.input.gain, params, 'amp', 1)
    bus.input.connect(bus.output)
    // Out mix
    system.mix(bus.output)
    // Cleanup
    bus.destroy = () => {
      bus.input.disconnect()
      bus.output.disconnect()
    }
    return bus
  }

  return createBus
})