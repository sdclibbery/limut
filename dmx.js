'use strict';
define(function(require) {
  let consoleOut = require('console')
  let {evalParamFrame} = require('player/eval-param')

  let numbeArray = [0]
  let convertValues = (v) => {
    if (Array.isArray(v)) { return v.filter(av => typeof av === 'number') }
    if (typeof v === 'object') {
      let values = []
      if (typeof v.value === 'number') { values[0] = v.value }
      if (typeof v.value1 === 'number') { values[1] = v.value1 }
      if (typeof v.value2 === 'number') { values[2] = v.value2 }
      if (typeof v.value3 === 'number') { values[3] = v.value3 }
      if (typeof v.r === 'number') { values[0] = v.r }
      if (typeof v.g === 'number') { values[1] = v.g }
      if (typeof v.b === 'number') { values[2] = v.b }
      if (typeof v.w === 'number') { values[3] = v.w }
      if (typeof v.x === 'number') { values[0] = v.x }
      if (typeof v.y === 'number') { values[1] = v.y }
      if (typeof v.z === 'number') { values[2] = v.z }
      return values
    }
    if (typeof v === 'number') { numbeArray[0] = v; return numbeArray }
    return []
  }

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
  let setChannel = (channel, value, event) => {
    if (typeof channel !== 'number' || channel < 1 || channel > 320) {
      consoleOut(`🔴 DMX channel ${channel} out of range (1-320) for player ${event.player}`) // For now going to limit to 320 channels to "guarantee" 60hz
      return
    }
    let channelIdx = channel - 1 // channel numbers are one-based, but the channels array is zero based
    if (channels[channelIdx] === undefined) {
      channels[channelIdx] = {}
    }
    channels[channelIdx].value = value
    channels[channelIdx].event = event
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
      // console.log('DMX sending:', Array.from(data.subarray(1,5)))
    } finally {
      writing = false
    }
  }

  let buffer = new Uint8Array(321)
  buffer[0] = 0x00 // DMX start code
  let perFrameUpdate = (timeNow) => {
    if (channels.length === 0) { return } // do nothing at all if noone is even asking for dmx
    if (!inited) { init() }
    if (!port) { return }
    if (!writer) { console.log('DMX writer not inited'); return }
    if (!writer.ready) { console.log('DMX writer not ready'); return }
    if (writing) { console.log(`Warning: DMX send overrun`); return } // Still writing the last packet, ignore this one
    channels.forEach(({value,event}, idx) => {
      let bufferIdx = idx + 1 // channels array is zero based, but the data buffer has one start byte first
      let evalled = evalParamFrame(value || 0, event, timeNow) || 0
      convertValues(evalled).forEach((v,valueIdx) => { // If evalled was a colour or something, write all values
        buffer[bufferIdx+valueIdx] = Math.floor(Math.min(Math.max(v,0),1) * 255)
      })
    })
    sendData(buffer)
  }

  return {
    setChannel: setChannel,
    perFrameUpdate: perFrameUpdate,
  }
})
