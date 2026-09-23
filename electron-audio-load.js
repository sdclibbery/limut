// Audio thread load for the Electron build: Chromium's render capacity metric, which the page
// cannot reach (see play/system.js) but the main process can, over the DevTools protocol. Read it
// here, push it to the page over IPC, and preload.js hands it to Limut.
//
// Each poll is a burst (attach, enable, read, disable, detach), because while the WebAudio domain
// is enabled Chromium traces every node and param event over IPC, adding load. Chromium computes
// the metric continuously, so getRealtimeData reads the last value with no warm-up needed.

const POLL_MS = 500
const CHANNEL = 'limut:audio-load'

let start = (win) => {
  let wc = win.webContents
  let contextId = null
  let timer = null

  // Registered once: the debugger object outlives any individual attach/detach.
  wc.debugger.on('message', (event, method, params) => {
    if (method === 'WebAudio.contextCreated' && params.context.contextType === 'realtime') {
      contextId = params.context.contextId
    } else if (method === 'WebAudio.contextWillBeDestroyed' && params.contextId === contextId) {
      contextId = null
    }
  })

  let readOnce = async () => {
    let dbg = wc.debugger
    // Attaching alongside an open DevTools window works (Chromium allows several CDP clients).
    // If an attach fails, the poll yields no reading, the meter hides, and the next poll retries.
    dbg.attach('1.3')
    try {
      await dbg.sendCommand('WebAudio.enable')
      if (contextId === null) {
        // contextCreated is emitted while enable is being handled; give it a moment in
        // case the event lands just after the command response.
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      if (contextId === null) { return null }
      let {realtimeData} = await dbg.sendCommand('WebAudio.getRealtimeData', {contextId})
      return {
        renderCapacity: realtimeData.renderCapacity,
        callbackIntervalMean: realtimeData.callbackIntervalMean,
        callbackIntervalVariance: realtimeData.callbackIntervalVariance,
      }
    } finally {
      try { await dbg.sendCommand('WebAudio.disable') } catch (e) {}
      try { dbg.detach() } catch (e) {}
    }
  }

  let poll = async () => {
    if (wc.isDestroyed()) { return }
    let load = null
    try {
      load = await readOnce()
    } catch (e) {
      contextId = null // a stale id is the one failure worth retrying from scratch
    }
    if (!wc.isDestroyed()) { wc.send(CHANNEL, load) }
  }

  wc.on('did-finish-load', () => {
    if (timer === null) { timer = setInterval(poll, POLL_MS) }
  })
  win.on('closed', () => {
    clearInterval(timer)
    timer = null
  })
}

module.exports = {start}
