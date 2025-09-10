'use strict';
define(function(require) {
  let consoleOut = require('console')
  let newRenderList = require('draw/render-list')
  let metronome = require('metronome')

  let toByte = (v) => Math.floor(Math.min(Math.max(v, 0), 0xff))

  let renderList = newRenderList()
  let addRenderer = (startTime, render, zorder) => {
    renderList.add(startTime, render, zorder || 0)
  }

  let buffer = new Uint8Array(513) // 1 start code + 512 channels
  buffer[0] = 0x00 // DMX start code
  let blendChannel = (channel, value, blend) => {
    if (typeof channel !== 'number' || channel < 1 || channel > 512) {
      consoleOut(`🔴 DMX channel ${channel} out of range (1-512)`)
      return
    }
    let newValue
    if (blend === 'set') { newValue = value*0xff }
    else if (blend.startsWith('sub')) { newValue = buffer[channel] - value*0xff }
    else if (blend === 'invert') { newValue = buffer[channel] + (1 - value)*0xff }
    else if (blend === 'average') { newValue = (buffer[channel] + value*0xff) / 2 }
    else if (blend.startsWith('mul')) { newValue = (buffer[channel] * value*0xff) / 0xff }
    else if (blend === 'max') { newValue = Math.max(buffer[channel], value*0xff) }
    else if (blend === 'min') { newValue = Math.min(buffer[channel], value*0xff) }
    else { newValue = buffer[channel] + value*0xff } // default to additive
    buffer[channel] = toByte(newValue) // channel is 1-based, buffer has a start code at 0
  }

  let inited = false
  let worker
  let init = async () => {
    inited = true
    if (!navigator.serial) {
      consoleOut('🔴 Cannot use DMX: Web Serial API not supported on this browser')
      return
    }
    await navigator.serial.requestPort().catch(e => {}) // ask user or electron for device. ignore errors
    worker = new Worker('draw/dmx-worker.js') // Use a web worker to maintain 40hz DMX update rate
  }

  let renderState = {time:0}
  let perFrameUpdate = (timeNow) => {
    if (renderList.isEmpty()) { return } // Do nothing if no dmx is ever called for
    if (!inited) { init() }
    if (!worker) { return }
    buffer.fill(0,1,-1) // Clear buffer to zero before collecting values
    renderState.time = timeNow
    renderState.count = metronome.beatTime(timeNow)
    renderList.render(renderState)
    worker.postMessage(buffer)
  }

  return {
    addRenderer: addRenderer,
    blendChannel: blendChannel,
    perFrameUpdate: perFrameUpdate,
  }
})
