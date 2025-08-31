'use strict';
define(function(require) {
  let consoleOut = require('console')

  let inited = false
  let port
  let writer
  let init = async () => {
    inited = true
    if (!navigator.serial) {
      consoleOut('🔴 Cannot use DMX: Web Serial API not supported on this browser')
      return
    }
    await navigator.serial.requestPort().catch(e => {}) // ignore errors, just try again later
    let deviceCriteria = {filters: [{usbVendorId: 0x0403}]}
    let ports = await navigator.serial.getPorts()//deviceCriteria)
    console.log('DMX available ports: ', ports)
    if (ports.length === 0) {
      consoleOut('🔴 Cannot use DMX: No ports found')
      return
    }
    port = ports[0] // Just pick the first for now
    consoleOut(`🔵 Using DMX port: ${port.getInfo().usbVendorId}:${port.getInfo().usbProductId}:${port.getInfo().bluetoothServiceClassId}`)
    await port.open({
      baudRate: 250000,
      dataBits: 8,
      stopBits: 2,
      parity: "none",
    })
    writer = await port.writable.getWriter()
  }

  let channels = []
  let setChannel = (channel, value) => {
    if (typeof channel !== 'number' || channel < 0 || channel > 320) {
      consoleOut(`🔴 DMX channel ${channel} out of range (1-320)`) // For now going to limit to 320 channels to guarantee 60hz
      return
    }
    channels[channel] = value
  }

  let doWrite = async (data) => {
    await port.setSignals({break: true, requestToSend: false})
    await port.setSignals({break: false, requestToSend: false})
    await writer.write(data)
  }

  let buffer = new Uint8Array(321)
  buffer[0] = 0x00 // DMX start code
  let perFrameUpdate = (timeNow) => {
    if (channels.length === 0) { return } // do nothing at all if noone is even asking for dmx
    if (!inited) { init() }
    if (!port) { return }
    if (!writer) { console.log('DMX writer not inited'); return }
    if (!writer.ready) { console.log('DMX writer not ready'); return }
    channels.forEach((v, idx) => {
      buffer[idx + 1] = Math.floor(v * 255) % 256
    })
    doWrite(buffer)
  }

  return {
    setChannel: setChannel,
    perFrameUpdate: perFrameUpdate,
  }
})
