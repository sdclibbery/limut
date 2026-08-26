// Audio thread load for the Electron build: Chromium's own "render capacity" metric, the
// one the DevTools WebAudio tab shows. It is not reachable from the page - there is no
// AudioContext.renderCapacity in this build (see the comment in play/system.js) - but it
// *is* reachable over the DevTools protocol, which the main process can speak to its own
// renderer. Read it here, push it to the page over IPC, and preload.js hands it to Limut.
//
// Each poll is a burst: attach, enable, read, disable, detach. While the WebAudio domain
// is enabled Chromium traces the whole audio graph, emitting an event for every node and
// every AudioParam created, connected and destroyed - and Limut builds a lot of nodes per
// beat, each event an IPC message to this process. A load meter that adds load is worse
// than no meter. Chromium computes the metric on every audio callback regardless of who
// is listening, so getRealtimeData just reads the last value: there is no warm-up window
// to miss. Measured: 20 bursts while a heavy patch played let through 20 contextCreated
// messages and not one node or param event, so the tracing window really is empty.

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
    // Attaching alongside an open DevTools window works - Chromium allows several CDP
    // clients on one target, and the readings were measured still updating with the
    // DevTools WebAudio tab open. If an attach ever does fail, the poll simply yields no
    // reading, the meter hides, and the next poll tries again.
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
