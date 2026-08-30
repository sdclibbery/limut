// Audio thread diagnostics for the Electron build. Off unless LIMUT_DIAG=1, and it *replaces*
// electron-audio-load.js for the run (both drive the same debugger, and the load meter's polite
// burst pattern is the opposite of what a diagnostic wants).
//
// This exists because the audio thread is otherwise unobservable from the page: renderCapacity is
// Electron-only (see play/system.js) and nothing in the Web Audio API says how many nodes are
// actually in the render graph. Two leaks have now been found by watching that node count grow -
// a started MessagePort pinning its AudioWorkletNode (play/worklet-lifecycle.js), and glide
// retaining every event forever (play/effects/pitch-effects.js) - so the instrument is worth
// keeping rather than rebuilding from scratch each time.
//
//   LIMUT_DIAG=1                 enable, replacing the normal audio load meter
//   LIMUT_DIAG_CODE=<path>       .limut file to run once the page is up
//   LIMUT_DIAG_NODES=1           live AudioNode census by type (see the cost note below)
//   LIMUT_DIAG_STOP=<seconds>    fire window.stop() (ie Ctrl-.) this far into the run
//   LIMUT_DIAG_SECS=<seconds>    quit this far into the run
//
// eg: LIMUT_DIAG=1 LIMUT_DIAG_CODE=/tmp/a.limut LIMUT_DIAG_NODES=1 LIMUT_DIAG_STOP=120 \
//     LIMUT_DIAG_SECS=180 npm start
//
// The census needs the WebAudio domain enabled for the whole run, which makes Chromium trace every
// node and param created, connected and destroyed - one IPC message each, and Limut builds a lot of
// nodes per beat. That perturbs what is being measured, so capacity figures from a census run read
// slightly high; compare census runs with census runs. getRealtimeData only answers while the
// domain is enabled, hence the burst when the census is off.

const SAMPLE_MS = 250
const REPORT_EVERY = 40 // samples, ie 10s

let fs = require('fs')

let start = (app, win) => {
  let wc = win.webContents
  let census = process.env.LIMUT_DIAG_NODES === '1'
  let contextId = null
  let nodeTypes = {} // nodeId -> nodeType
  let live = {}      // nodeType -> count
  let t0 = Date.now()
  let samples = []
  let stopped = false

  let elapsed = () => (Date.now() - t0) / 1000

  wc.debugger.on('message', (event, method, params) => {
    if (method === 'WebAudio.contextCreated') {
      if (params.context.contextType === 'realtime') { contextId = params.context.contextId }
    } else if (method === 'WebAudio.contextWillBeDestroyed') {
      if (params.contextId === contextId) { contextId = null }
    } else if (method === 'WebAudio.audioNodeCreated') {
      nodeTypes[params.node.nodeId] = params.node.nodeType
      live[params.node.nodeType] = (live[params.node.nodeType] || 0) + 1
    } else if (method === 'WebAudio.audioNodeWillBeDestroyed') {
      let type = nodeTypes[params.nodeId]
      if (type !== undefined) { live[type] -= 1; delete nodeTypes[params.nodeId] }
    }
  })

  let attach = () => { try { wc.debugger.attach('1.3') } catch (e) {} }

  let readCapacity = async () => {
    if (contextId === null) { return null }
    try {
      let {realtimeData} = await wc.debugger.sendCommand('WebAudio.getRealtimeData', {contextId})
      return realtimeData
    } catch (e) { return null }
  }

  // Burst enable/disable per read when the census is off, so the tracing window stays empty.
  let readOnce = async () => {
    if (census) { return await readCapacity() }
    attach()
    try {
      await wc.debugger.sendCommand('WebAudio.enable')
      if (contextId === null) { await new Promise(r => setTimeout(r, 50)) }
      return await readCapacity()
    } catch (e) {
      contextId = null
      return null
    } finally {
      try { await wc.debugger.sendCommand('WebAudio.disable') } catch (e) {}
      try { wc.debugger.detach() } catch (e) {}
    }
  }

  // Main thread frame timing. renderCapacity is wall clock time in the render quantum, so a main
  // thread that stalls (a big GC over a leaked object graph, say) starves the audio thread and shows
  // up as high capacity even with an empty audio graph. Measuring both is what tells them apart.
  let installFrameProbe = () => wc.executeJavaScript(`(() => {
    if (window.__diagFrames) { return }
    let deltas = []
    let last = performance.now()
    let tick = () => {
      let t = performance.now()
      deltas.push(t - last)
      last = t
      if (deltas.length > 600) { deltas.shift() }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    window.__diagFrames = () => {
      let d = deltas.slice()
      deltas.length = 0
      if (!d.length) { return null }
      return {mean: d.reduce((a,b)=>a+b,0)/d.length, max: Math.max.apply(null, d), n: d.length}
    }
  })()`).catch(() => null)

  // Everything the page can tell us that the audio graph cannot: worklet processors still
  // rendering, live (keyboard/gamepad/midi) voices awaiting a note off, per frame callbacks, heap.
  let pageCensus = () => wc.executeJavaScript(`(() => {
    let s = require('play/system')
    let env = require('play/envelopes')
    let m = performance.memory
    return {
      voices: s.voiceCount(),
      liveVoices: env.liveVoiceCount ? env.liveVoiceCount() : -1,
      active: s.active.length,
      queued: s.queued.length,
      heapMB: m ? Math.round(m.usedJSHeapSize/1e5)/10 : -1,
      frames: window.__diagFrames ? window.__diagFrames() : null,
    }
  })()`).catch(() => null)

  let report = async () => {
    let caps = samples.filter(c => typeof c === 'number').sort((a,b) => a-b)
    samples.length = 0
    let fmt = (v) => v === undefined ? 'NA' : v.toFixed(4)
    let mean = caps.length ? caps.reduce((a,b) => a+b, 0)/caps.length : undefined
    let p90 = caps.length ? caps[Math.min(caps.length-1, Math.floor(caps.length*0.9))] : undefined
    let max = caps.length ? caps[caps.length-1] : undefined
    let page = await pageCensus()
    let liveList = Object.keys(live)
      .filter(k => live[k] > 0)
      .sort((a,b) => live[b] - live[a])
      .map(k => `${k}:${live[k]}`)
      .join(' ')
    console.log(
      `[diag] t=${elapsed().toFixed(0)}`
      + ` capMean=${fmt(mean)} capP90=${fmt(p90)} capMax=${fmt(max)} n=${caps.length}`
      + (page ? ` voices=${page.voices} liveVoices=${page.liveVoices} active=${page.active}`
              + ` queued=${page.queued} heapMB=${page.heapMB}`
              + (page.frames ? ` frameMean=${page.frames.mean.toFixed(1)}ms`
                             + ` frameMax=${page.frames.max.toFixed(0)}ms` : '') : ' page=NA')
      + (lastInterval ? ` cbMean=${(lastInterval.callbackIntervalMean*1000).toFixed(3)}ms`
                      + ` cbSD=${(Math.sqrt(lastInterval.callbackIntervalVariance)*1000).toFixed(3)}ms` : '')
      + (stopped ? ' STOPPED' : '')
      + (census ? `\n[diag]   live ${liveList || '(none)'}` : '')
    )
  }

  let n = 0
  let lastInterval = null
  let tick = async () => {
    let data = await readOnce()
    samples.push(data ? data.renderCapacity : undefined)
    if (data) { lastInterval = data }
    if (++n % REPORT_EVERY === 0) { await report() }
  }

  wc.on('did-finish-load', async () => {
    if (census) {
      attach()
      try { await wc.debugger.sendCommand('WebAudio.enable') } catch (e) {}
      await new Promise(r => setTimeout(r, 100))
    }

    let codePath = process.env.LIMUT_DIAG_CODE
    if (codePath) {
      // did-finish-load only means the document is done; require.js is still pulling in modules,
      // so poll for the one we need rather than racing it.
      for (let i = 0; i < 200; i++) {
        let ready = await wc.executeJavaScript(
          `!!(window.require && window.require.defined && window.require.defined('update-code') && window.go)`
        ).catch(() => false)
        if (ready) { break }
        await new Promise(r => setTimeout(r, 100))
      }
      let src = fs.readFileSync(codePath, 'utf8')
      // updateCode, not the editor: writing through CodeMirror would persist the diagnostic patch
      // into localStorage['limut-code'] and clobber whatever the user had open.
      await wc.executeJavaScript(`(async () => {
        await require('play/system').resume()
        require('update-code').updateCode(${JSON.stringify(src)})
      })()`)
      console.log(`[diag] running ${codePath}`)
    }

    await installFrameProbe()
    setInterval(tick, SAMPLE_MS)

    let stopAt = parseFloat(process.env.LIMUT_DIAG_STOP)
    if (stopAt > 0) {
      setTimeout(async () => {
        await wc.executeJavaScript('window.stop()')
        stopped = true
        console.log(`[diag] t=${elapsed().toFixed(0)} window.stop()`)
      }, stopAt*1000)
    }

    let quitAt = parseFloat(process.env.LIMUT_DIAG_SECS)
    if (quitAt > 0) {
      setTimeout(async () => { await report(); app.quit() }, quitAt*1000)
    }
  })
}

module.exports = {start}
