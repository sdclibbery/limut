'use strict'
// End to end check of the limut host side (draw/hub75/host/) against the mock display.
//
// The inline ?test blocks cover the pure parts - hashing, chunk maths, endpoint resolution, layer
// keys - but they cannot prove the thing that actually matters: that a real browser running the
// real app, given a real px chain, uploads the right asset, compiles the right program, binds a
// layer and then holds a 60Hz uniform stream. This drives exactly that, and asserts on what the
// *display* observed, which is the same standard selftest.js holds the display itself to.
//
//   sh server.sh                          # limut must be served on :8000
//   node draw/hub75/mock/host-check.js
//
// Chrome is driven by URL alone: no CDP, because Chrome 148's Runtime.evaluate hangs. mock/
// harness.html seeds the editor through localStorage and calls the app's own go().

let http = require('node:http')
let { spawn } = require('node:child_process')
let display = require('./display')

let CHROME = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
let LIMUT = process.env.LIMUT_URL || 'http://localhost:8000'
let PORT = 7576 // not 7575, so a mock left running for manual work is not disturbed

let passed = 0
let failed = 0
let check = (name, ok, detail) => {
  if (ok) { passed++; console.log('  PASS  ' + name) }
  else { failed++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + detail : '')) }
}

let sleep = (ms) => new Promise(r => setTimeout(r, ms))

let serverUp = () => new Promise(resolve => {
  let req = http.get(LIMUT + '/', res => { res.resume(); resolve(res.statusCode < 400) })
  req.on('error', () => resolve(false))
  req.setTimeout(2000, () => { req.destroy(); resolve(false) })
})

// Count every message type the host sends, so "a failed program is never resent" can be asserted
// as a number rather than inferred from the absence of an error
let instrument = (d) => {
  let counts = {}
  let dims = []
  let inner = d.handleText
  d.handleText = (conn, text) => {
    try {
      let t = JSON.parse(text).type
      counts[t] = (counts[t] || 0) + 1
    } catch (e) {}
    return inner(conn, text)
  }
  let innerFrame = d.handleFrame
  d.handleFrame = (conn, bytes) => {
    let r = innerFrame(conn, bytes)
    dims.push(d.dim)
    return r
  }
  return { counts, dims }
}

let runNumber = 0
let runChrome = (url, seconds, extraFlags) => {
  // A fresh profile per run. A shared one caches the app's modules, and the dev server sends no
  // Cache-Control, so a scenario would quietly exercise the previous edit's code and pass or fail
  // for the wrong reason - which is exactly what happened while this file was being written.
  let profile = `/tmp/limut-hub75-check-profile-${process.pid}-${++runNumber}`
  let args = [
    '--headless=new',
    '--autoplay-policy=no-user-gesture-required', // no user gesture in headless, so the audio clock would never start
    '--enable-logging=stderr', '--v=1',
    '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile,
  ].concat(extraFlags || []).concat([url])
  let p = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  let log = ''
  p.stderr.on('data', b => { log += b.toString() })
  return {
    done: sleep(seconds * 1000).then(() => {
      p.kill()
      try { require('node:fs').rmSync(profile, {recursive: true, force: true}) } catch (e) {}
      return log
    }),
    proc: p,
  }
}

let consoleLines = (log) => log.split('\n')
  .filter(l => l.indexOf('INFO:CONSOLE') !== -1)
  .map(l => l.replace(/^.*CONSOLE[^"]*"/, '').replace(/", source:.*$/, ''))

// ---- scenarios -------------------------------------------------------------------------------

let PX = "px=mul{sin{}}>>tex1d{{x}->{labh:x}}"

let scenarioHappy = async () => {
  console.log('\nhappy path: one lut, one program, a bound layer and a 60Hz stream')
  let d = display.start({ port: PORT, name: 'hub75-check', w: 128, h: 64, failCompile: null, drop: 0, verbose: false })
  let seen = instrument(d.display)
  let code = `v1 visualsynth, ${PX}, display='localhost:${PORT}', dim=[0:1]l`
  let url = `${LIMUT}/draw/hub75/mock/harness.html?code=${encodeURIComponent(code)}`
  let log = await runChrome(url, 20).done
  let x = d.display

  check('a session was opened', x.sessions >= 1, `sessions=${x.sessions}`)
  check('exactly one asset was uploaded', x.assets.size === 1, `assets=${x.assets.size}`)
  let asset = Array.from(x.assets.values())[0]
  if (asset) {
    check('the asset is a 1d lut of 256 texels', asset.kind === 'lut' && asset.dims === 1 && asset.size === 256,
      JSON.stringify({ kind: asset.kind, dims: asset.dims, size: asset.size }))
    // The display verifies the SHA-256 itself before caching, so its presence here is the proof
    check('its bytes hash to the announced id', asset.data.length === 256 * 4, `${asset.data.length} bytes`)
  } else {
    check('the asset is a 1d lut of 256 texels', false, 'no asset cached')
    check('its bytes hash to the announced id', false, 'no asset cached')
  }
  check('one program was sent and it compiled', x.progs.size === 1 && Array.from(x.progs.values())[0].ok,
    JSON.stringify(Array.from(x.progs.values()).map(p => ({ ok: p.ok, log: p.log }))))
  let prog = Array.from(x.progs.values())[0]
  if (prog) {
    // checkProgram already rejected a uniform list that disagrees with the source, which is the
    // silent wrong picture bug positional slots make possible
    check('its uniform list matches the source', prog.uniforms.length === 1 && prog.uniforms[0] === 'u_vs0',
      JSON.stringify(prog.uniforms))
    check('the source is a self contained #version 300 es shader',
      /^#version 300 es\b/.test(prog.frag) && prog.frag.indexOf('uniform sampler2D u_vstex0;') !== -1)
  }
  check('a layer is bound', x.layer !== null && x.layer.id === 0, JSON.stringify(x.layer))
  if (x.layer) {
    check('the layer binds unit 0 to the cached asset',
      x.layer.textures.length === 1 && x.layer.textures[0].unit === 0 && x.assets.has(x.layer.textures[0].asset),
      JSON.stringify(x.layer.textures))
  }
  check('at least 60 frame packets arrived', x.lastSeq >= 60, `lastSeq=${x.lastSeq}`)
  check('frames were consumed at the display cadence', x.stats.rendered > 30, `rendered=${x.stats.rendered}`)
  // A uniform count that disagreed with the bound program is a session closing protocol error, so
  // a session still open after hundreds of frames is itself the assertion
  check('the session survived the whole stream', x.session !== null)
  check('dim=[0:1]l swept rather than sitting at its default',
    Math.max(...seen.dims) - Math.min(...seen.dims) > 0.1,
    `dim range ${Math.min(...seen.dims).toFixed(3)}..${Math.max(...seen.dims).toFixed(3)}`)
  check('the layer was bound once, not re-sent every event', seen.counts.layer === 1,
    `layer messages=${seen.counts.layer}`)
  check('the program was sent once', seen.counts.prog === 1, `prog messages=${seen.counts.prog}`)

  let lines = consoleLines(log)
  check('the host reported the connection', lines.some(l => /hub75 .*connected/.test(l)),
    lines.filter(l => /hub75/.test(l)).join('\n          ') || '(no hub75 console output)')
  check('nothing errored in the app', !lines.some(l => /🔴/.test(l)),
    lines.filter(l => /🔴/.test(l)).join('\n          '))

  d.stop()
}

let scenarioCompileFailure = async () => {
  console.log('\ncompile failure: reported once, and the program is never re-sent')
  let d = display.start({ port: PORT, name: 'hub75-check', w: 128, h: 64, failCompile: 'u_vstex0', drop: 0, verbose: false })
  let seen = instrument(d.display)
  let code = `v1 visualsynth, ${PX}, display='localhost:${PORT}'`
  let url = `${LIMUT}/draw/hub75/mock/harness.html?code=${encodeURIComponent(code)}`
  let log = await runChrome(url, 20).done
  let x = d.display

  check('a session was opened', x.sessions >= 1, `sessions=${x.sessions}`)
  check('the program is cached as failed', x.progs.size === 1 && !Array.from(x.progs.values())[0].ok)
  // The point of the whole test: a compile failure is permanent for that source, exactly as
  // draw/visualsynth.js treats a local one, so a player firing every beat must not resend it
  check('the program was sent exactly once despite many events', seen.counts.prog === 1,
    `prog messages=${seen.counts.prog}`)
  check('no layer was bound', x.layer === null, JSON.stringify(x.layer))
  check('frames still flow, carrying no layer', x.lastSeq >= 60, `lastSeq=${x.lastSeq}`)

  let lines = consoleLines(log)
  check('the host surfaced the compile error with its log',
    lines.some(l => /hub75 .*shader compile error/.test(l)),
    lines.filter(l => /hub75/.test(l)).join('\n          ') || '(no hub75 console output)')

  d.stop()
}

let scenarioPacketLoss = async () => {
  console.log('\npacket loss: the stream stays up and is accounted for')
  let d = display.start({ port: PORT, name: 'hub75-check', w: 128, h: 64, failCompile: null, drop: 20, verbose: false })
  let code = `v1 visualsynth, ${PX}, display='localhost:${PORT}'`
  let url = `${LIMUT}/draw/hub75/mock/harness.html?code=${encodeURIComponent(code)}`
  await runChrome(url, 18).done
  let x = d.display

  check('a layer is still bound', x.layer !== null)
  check('losses were counted', x.stats.dropped > 0, `dropped=${x.stats.dropped}`)
  check('the stream kept going through them', x.lastSeq >= 60, `lastSeq=${x.lastSeq}`)
  check('the session survived', x.session !== null)

  d.stop()
}

let scenarioRestart = async () => {
  console.log('\nrestart: the display comes back with empty caches and must be re-supplied')
  let d = display.start({ port: PORT, name: 'hub75-check', w: 128, h: 64, failCompile: null, drop: 0, verbose: false })
  let code = `v1 visualsynth, ${PX}, display='localhost:${PORT}'`
  let url = `${LIMUT}/draw/hub75/mock/harness.html?code=${encodeURIComponent(code)}`
  let run = runChrome(url, 34)

  await sleep(15000)
  let boundBefore = d.display.layer !== null
  let assetsBefore = d.display.assets.size
  // Order matters. stop() closes the listener but leaves live sockets up, so the socket has to be
  // dropped too - and it has to be dropped *after* the listener is gone, or the host's first
  // 250ms retry reconnects to the display that is about to disappear and then sits happily on a
  // socket nothing is serving.
  d.stop()
  if (d.display.session) { d.display.session.conn.close(1000, 'restart') }
  await sleep(2500) // everything the display knew is gone, and the port is free again
  // A brand new display on the same port: same name, no caches, exactly as a power cycle looks
  let d2 = display.start({ port: PORT, name: 'hub75-check', w: 128, h: 64, failCompile: null, drop: 0, verbose: false })
  let seen2 = instrument(d2.display)
  let log = await run.done
  let x = d2.display
  let lines = consoleLines(log)

  check('a layer was bound before the restart', boundBefore && assetsBefore === 1)
  check('the host noticed the disconnect', lines.some(l => /hub75 .*disconnected/.test(l)),
    lines.filter(l => /hub75/.test(l)).join('\n          ') || '(no hub75 console output)')
  check('the host reconnected to the new display', x.sessions >= 1, `sessions=${x.sessions}`)
  // The bug this scenario exists for: a host that trusted its own idea of the display's cache
  // would bind a layer naming a program this display has never seen, which is a session closing
  // protocol error - and it would then reconnect straight back into the same wrong assumption
  check('it re-uploaded the asset rather than assuming it was cached', x.assets.size === 1,
    `assets=${x.assets.size}`)
  check('it re-sent the program', x.progs.size === 1, `progs=${x.progs.size}`)
  check('a layer is bound on the new display', x.layer !== null, JSON.stringify(x.layer))
  check('no protocol error closed the session', x.session !== null)
  check('the stream is flowing again', x.lastSeq >= 30, `lastSeq=${x.lastSeq}`)
  check('it asked before re-sending', seen2.counts.have >= 1, `have messages=${seen2.counts.have}`)
  check('it reported connecting a second time', lines.filter(l => /hub75 [^ ]+: connected/.test(l)).length >= 2,
    lines.filter(l => /hub75/.test(l)).join('\n          '))

  d2.stop()
}

let scenarioReconnect = async () => {
  console.log('\nreconnect: the content addressed caches make it a have round trip, not a re-upload')
  let d = display.start({ port: PORT, name: 'hub75-check', w: 128, h: 64, failCompile: null, drop: 0, verbose: false })
  let seen = instrument(d.display)
  let code = `v1 visualsynth, ${PX}, display='localhost:${PORT}'`
  let url = `${LIMUT}/draw/hub75/mock/harness.html?code=${encodeURIComponent(code)}`
  let run = runChrome(url, 26)

  // Drop the socket from the display end once the layer is up, leaving the display's caches intact
  await sleep(14000)
  let boundBefore = d.display.layer !== null
  let seqBefore = d.display.lastSeq
  if (d.display.session) { d.display.session.conn.close(1000, 'test disconnect') }
  await run.done
  let x = d.display

  check('a layer was bound before the disconnect', boundBefore)
  check('the host reconnected', x.sessions >= 2, `sessions=${x.sessions}`)
  check('it asked what was missing rather than assuming', seen.counts.have >= 1, `have messages=${seen.counts.have}`)
  // The whole point of content addressing: caches survive the session change (PROTOCOL.md 5.1), so
  // a reconnect costs a round trip rather than re-uploading every texture
  check('the asset was uploaded only once across both sessions', seen.counts.asset === 1,
    `asset announces=${seen.counts.asset}`)
  check('the program was sent only once', seen.counts.prog === 1, `prog messages=${seen.counts.prog}`)
  check('the layer was re-bound on the new session', seen.counts.layer === 2, `layer messages=${seen.counts.layer}`)
  check('a layer is bound again', x.layer !== null)
  check('the stream resumed', x.lastSeq > seqBefore, `seq ${seqBefore} -> ${x.lastSeq}`)

  d.stop()
}

let scenarioLiveEdit = async () => {
  console.log('\nlive edit: a changed lut re-binds even though the GLSL is byte identical')
  let d = display.start({ port: PORT, name: 'hub75-check', w: 128, h: 64, failCompile: null, drop: 0, verbose: false })
  let seen = instrument(d.display)
  // Same chain shape, inverted lut. codegen bakes only the lut's *size* into the source, so both
  // edits generate byte identical GLSL and share a program id while needing different texture data.
  // If the host keyed layers on the shader alone, the second would silently render the first's lut.
  let one = `v1 visualsynth, px=mul{sin{}}>>tex1d{{x}->x}, display='localhost:${PORT}'`
  let two = `v1 visualsynth, px=mul{sin{}}>>tex1d{{x}->1-x}, display='localhost:${PORT}'`
  let url = `${LIMUT}/draw/hub75/mock/harness.html?code=${encodeURIComponent(one)}` +
    `&code2=${encodeURIComponent(two)}&runafter2=9000`
  await runChrome(url, 26).done
  let x = d.display

  check('both luts were uploaded', x.assets.size === 2, `assets=${x.assets.size}`)
  check('they are different bytes', (() => {
    let a = Array.from(x.assets.values())
    return a.length === 2 && Buffer.compare(a[0].data, a[1].data) !== 0
  })())
  check('the two chains shared one program', x.progs.size === 1 && seen.counts.prog === 1,
    `progs cached=${x.progs.size} prog messages=${seen.counts.prog}`)
  check('the layer was re-bound for the second lut', seen.counts.layer === 2, `layer messages=${seen.counts.layer}`)
  let last = x.layer
  check('the bound layer names the second lut', last !== null &&
    last.textures.length === 1 && last.textures[0].asset === Array.from(x.assets.keys())[1],
    JSON.stringify(last))
  check('the session survived the swap', x.session !== null)

  d.stop()
}

let scenarioWebcam = async () => {
  console.log('\nwebcam: refused rather than bound, because it cannot be shipped')
  let d = display.start({ port: PORT, name: 'hub75-check', w: 128, h: 64, failCompile: null, drop: 0, verbose: false })
  let seen = instrument(d.display)
  let code = `v1 visualsynth, px=tex{webcam{}}, display='localhost:${PORT}'`
  let url = `${LIMUT}/draw/hub75/mock/harness.html?code=${encodeURIComponent(code)}`
  let log = await runChrome(url, 20, [
    '--use-fake-device-for-media-stream', // a real capture texture, so this exercises the refusal
    '--use-fake-ui-for-media-stream',     // rather than the "not ready yet" path
  ]).done
  let x = d.display

  check('a session was opened anyway', x.sessions >= 1, `sessions=${x.sessions}`)
  check('no program was sent', seen.counts.prog === undefined, `prog messages=${seen.counts.prog}`)
  check('no layer was bound', x.layer === null, JSON.stringify(x.layer))
  // Frames keep flowing with layerCount 0, so dim and the beat clock stay live with nothing bound
  check('frames still flow, carrying no layer', x.lastSeq >= 60, `lastSeq=${x.lastSeq}`)
  let lines = consoleLines(log)
  check('the host said why', lines.some(l => /hub75 .*webcam/.test(l)),
    lines.filter(l => /hub75/.test(l)).join('\n          ') || '(no hub75 console output)')

  d.stop()
}

// ---- main ------------------------------------------------------------------------------------

let main = async () => {
  if (!(await serverUp())) {
    console.error(`🔴 limut is not being served at ${LIMUT}. Run: sh server.sh`)
    process.exit(2)
  }
  let only = process.argv[2]
  let all = {
    happy: scenarioHappy,
    compile: scenarioCompileFailure,
    loss: scenarioPacketLoss,
    reconnect: scenarioReconnect,
    restart: scenarioRestart,
    edit: scenarioLiveEdit,
    webcam: scenarioWebcam,
  }
  for (let name in all) {
    if (only && only !== name) { continue }
    await all[name]()
    await sleep(500) // let the port free up before the next scenario claims it
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => { console.error('🔴 ' + (e && e.stack || e)); process.exit(1) })
