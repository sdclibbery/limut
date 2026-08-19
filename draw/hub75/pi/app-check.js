'use strict'
// The whole chain at once: the real limut app, in a real browser, driving a real display.
//
//   sh server.sh                                        # limut on :8000
//   node draw/hub75/pi/app-check.js [host:port]
//
// Every other check covers one link. mock/selftest.js proves the display implements the
// protocol; mock/host-check.js proves the host side does, against the mock; pixel-check.js proves
// the two GL implementations agree. None of them runs the actual host against the actual
// display, and that is the only thing that can catch a disagreement the mock happens to be
// lenient about.
//
// It asserts on what the DISPLAY observed, through /debug and /frame.raw, which is the same
// standard mock/host-check.js holds the host to. mock/harness.html is how the browser gets in:
// same origin as limut, code seeded through localStorage, the app's own go() called — there is
// no CDP route, Chrome 148's Runtime.evaluate hangs.

let fs = require('node:fs')
let http = require('node:http')
let net = require('node:net')
let { spawn } = require('node:child_process')

let EP = process.argv[2] || 'hub75-01.local:7575'
let CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
let LIMUT = process.env.LIMUT_URL || 'http://localhost:8000'
let SECONDS = 18

let passed = 0, failed = 0
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

let debug = async () => (await fetch(`http://${EP}/debug`)).json()

let frame = async () => {
  let res = await fetch(`http://${EP}/frame.raw`)
  return { w: +res.headers.get('x-width'), h: +res.headers.get('x-height'),
           px: Buffer.from(await res.arrayBuffer()) }
}

// A picture that never varies is either black or a held frame, and both would pass a check that
// only asked "did anything render"
let varied = (f) => {
  let first = f.px.readUInt32LE(0)
  for (let i = 1; i < f.w * f.h; i++) if (f.px.readUInt32LE(i * 4) !== first) return true
  return false
}

let run = async () => {
  if (!await serverUp()) {
    console.error(`🔴 limut is not being served at ${LIMUT}. Run: sh server.sh`)
    process.exit(2)
  }
  let info = await (await fetch(`http://${EP}/info`)).json()
  console.log(`${info.name} at ${EP}: ${info.display.w}x${info.display.h}, ${info.gl.renderer}`)

  // A display serves one session at a time and `takeover` is the norm, so a browser tab left
  // pointing at it will fight this check for the display and each will get about half the
  // frames. That shows up as a frame rate assertion failing for a reason nothing in the output
  // explains, so say it plainly rather than letting it look like a regression.
  if (info.busy) {
    console.log('\n  ⚠️  something is already holding a session on this display.')
    console.log('      Close any browser tab pointing at it — otherwise the two take it from')
    console.log('      each other and the frame rate check below sees roughly half the frames.\n')
  }

  // A browser opens speculative connections it may never use — Firefox preconnects several per
  // origin and holds them. A display whose connection table a handful of idle sockets can fill
  // stops answering, and from the browser that is indistinguishable from it being down: the app
  // reports `CORS request did not succeed, status code (null)`. Every other check in this repo
  // uses one connection at a time and would never notice.
  console.log('\nconnection pressure')
  {
    let host = EP.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
    let port = parseInt(EP.slice(EP.lastIndexOf(':') + 1), 10)
    let socks = []
    for (let i = 0; i < 40; i++) {
      let k = net.connect(port, host)
      k.on('error', () => {})
      socks.push(k)
    }
    await sleep(1500)
    let ok = false
    try {
      let c = new AbortController()
      let t = setTimeout(() => c.abort(), 5000)
      ok = (await fetch(`http://${EP}/info`, { signal: c.signal, cache: 'no-store' })).ok
      clearTimeout(t)
    } catch (e) { ok = false }
    check('still answers while 40 idle sockets are held', ok)
    socks.forEach(k => k.destroy())
    await sleep(500)
  }
  console.log('')

  // A chain with a lut in it, so the asset path is exercised and not just the shader, and a dim
  // timevar, so the dimmer is proven to arrive frame by frame rather than once
  let code = `v1 visualsynth, px=mul{sin{}}>>tex1d{{x}->{labh:x}}, display='${EP}', dim=[0.2:1]l`
  let url = `${LIMUT}/draw/hub75/mock/harness.html?code=${encodeURIComponent(code)}`
  console.log(`\n${code}\n`)

  let before = await debug()
  let profile = `/tmp/limut-app-check-${process.pid}`
  let chrome = spawn(CHROME, [
    '--headless=new',
    // no user gesture in headless, so the audio clock would never start and the beat would
    // never advance
    '--autoplay-policy=no-user-gesture-required',
    '--enable-logging=stderr', '--v=1',
    '--no-first-run', '--no-default-browser-check',
    // A fresh profile per run: a shared one caches the app's modules, the dev server sends no
    // Cache-Control, and a run would then quietly exercise the previous edit's code.
    '--user-data-dir=' + profile,
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  let log = ''
  chrome.stderr.on('data', b => { log += b.toString() })

  let samples = []
  let poll = setInterval(async () => {
    try { samples.push({ d: await debug(), f: await frame() }) } catch (e) {}
  }, 1000)

  await sleep(SECONDS * 1000)
  clearInterval(poll)
  chrome.kill()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch (e) {}

  let lines = log.split('\n').filter(l => l.indexOf('INFO:CONSOLE') !== -1)
    .map(l => l.replace(/^.*CONSOLE[^"]*"/, '').replace(/", source:.*$/, ''))
  let after = samples.length ? samples[samples.length - 1].d : before
  let mid = samples.slice(Math.floor(samples.length / 3))   // past connection and upload

  console.log('')
  check('the app reported connecting to the display',
    lines.some(l => /hub75 .*: connected/.test(l)),
    lines.filter(l => /hub75/.test(l)).join('\n          ') || '(no hub75 lines at all)')
  check('nothing errored in the app',
    !lines.some(l => /🔴/.test(l)),
    lines.filter(l => /🔴/.test(l)).join('\n          '))
  check('the display opened a new session', after.sessions > before.sessions,
    `sessions ${before.sessions} -> ${after.sessions}`)
  check('a layer is bound', after.layer !== null, JSON.stringify(after.layer))
  check('the layer binds the lut as a sampler2D',
    after.layer && after.layer.textures.length === 1 && after.layer.textures[0].sampler === 'sampler2D',
    JSON.stringify(after.layer && after.layer.textures))
  check('the sequence number advanced, so a uniform stream is running',
    after.lastSeq > 60, `lastSeq=${after.lastSeq}`)

  let drew = mid.length >= 2 ? mid[mid.length - 1].d.stats.rendered - mid[0].d.stats.rendered : 0
  let secs = Math.max(1, mid.length - 1)
  check('the display is drawing at roughly frame rate',
    drew / secs > 30, `${(drew / secs).toFixed(1)} frames a second`)

  check('the picture is not blank', mid.length > 0 && varied(mid[mid.length - 1].f))

  // dim=[0.2:1]l is a timevar, so it must be arriving in the frame packets rather than once
  let dims = mid.map(s => s.d.dim)
  check('the dimmer is live, not set once',
    new Set(dims.map(v => v.toFixed(2))).size > 1, `dim values seen: ${dims.map(v => v.toFixed(2)).join(' ')}`)
  check('and stays inside 0..1', dims.every(v => v >= 0 && v <= 1), JSON.stringify(dims))

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

run().catch(e => { console.error('\n🔴 app-check crashed:', e && e.stack || e); process.exit(1) })
