'use strict'
define((require) => {
  var system = require('play/system')

  let createBus = (busId, params) => {
    let bus = { id: busId }

    bus.input = system.audio.createGain()
    bus.output = system.audio.createGain()

    bus.input.connect(bus.output)
    
    system.mix(bus.output)
    bus.destroy = () => {
      bus.input.disconnect()
      bus.output.disconnect()
    }
    return bus
  }

  return createBus
})