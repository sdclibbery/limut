'use strict';
define(function(require) {
  let consoleOut = require('console')
  let newRenderList = require('draw/render-list')

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

  let renderList = newRenderList()
  let addRenderer = (startTime, render, zorder) => {
    renderList.add(startTime, render, zorder || 0)
  }

  let buffer = new Uint8Array(513) // 1 start code + 512 channels
  buffer[0] = 0x00 // DMX start code
  let maxChannel = 0
  let addToChannel = (channel, callback) => {
    if (typeof channel !== 'number' || channel < 1 || channel > 512) {
      consoleOut(`🔴 DMX channel ${channel} out of range (1-512)`)
      return
    }
    buffer[channel] += callback // channel is 1-based, buffer has a start code at 0
    maxChannel = Math.max(maxChannel, channel)
  }

  let writing = false
  let sendData = async (data) => {
    writing = true
    try {
      // let t1 = performance.now()
      await port.setSignals({break: true, requestToSend: false})
      // let t2 = performance.now()
      await port.setSignals({break: false, requestToSend: false})
      // let t3 = performance.now()
      await writer.write(data)
      // let t4 = performance.now()
      // console.log(t2-t1, t3-t2, t4-t3)
      // console.log('DMX sending:', data)
    } finally {
      writing = false
    }
  }

  let lastMaxChannel = 1
  let renderState = {time:0}
  let perFrameUpdate = (timeNow) => {
    if (renderList.isEmpty()) { return }
    if (!inited) { init() }
    if (!port) { return }
    if (!writer) { console.log('DMX writer not inited'); return }
    if (!writer.ready) { console.log('DMX writer not ready'); return }
    if (writing) { console.log(`Warning: DMX send overrun`); return } // Still writing the last packet, ignore this one
    buffer.fill(0,1,-1) // Clear buffer to zero before collecting values
    maxChannel = 1
    renderState.time = timeNow
    renderList.render(renderState)
    let maxChannelToUse = Math.max(maxChannel, lastMaxChannel) // Make sure we always send at least as many channels as last time, so that if a channel was on and is now off it gets turned off
    lastMaxChannel = maxChannel
    let endChannel = Math.ceil(maxChannelToUse/16)*16 // Round up to multiple of 16 to make sure entire dmx "block" gets sent
    sendData(buffer.subarray(0, endChannel-1+1+1)) // -1 because 1-based, +1 for start byte, +1 to make end inclusive
  }

  return {
    addRenderer: addRenderer,
    addToChannel: addToChannel,
    perFrameUpdate: perFrameUpdate,
  }
})
