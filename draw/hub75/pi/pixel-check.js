'use strict'
// Pixel parity: does the Pi render the same image as the browser, for the same shader?
//
//   node draw/hub75/pi/pixel-check.js [host:port]
//
// This is the one check neither mock/selftest.js nor mock/host-check.js can make. They prove the
// two ends agree about the PROTOCOL — messages, caches, error paths. They say nothing about
// whether Mesa v3d on the Pi, driven through PROTOCOL.md §13, puts the same colours in the same
// places as WebGL2 does in a browser. Every rule in §13 that could be got wrong — the constant
// vertex shader, the fullscreen quad, the y-up fragCoord, the sqrt aspect softening, LINEAR and
// CLAMP_TO_EDGE, the u_vsex == (0,0) rule for luts, the vertical flip on readback — fails here
// and nowhere else, and fails as a picture that is subtly wrong rather than as an error.
//
// The browser side is pixel-check.html: standalone WebGL2, no limut. The fragment sources below
// are shaped exactly as draw/visualsynth/codegen.js emits them.
//
// Run the display with --gamma 1, or every comparison is off by the gamma curve. The daemon's
// panel size is fixed at startup, so the fixtures are generated at whatever size /info reports;
// running it once at 128x64 and once at something wider than 2:1 covers both sides of the
// aspect softening branch.

let crypto = require('node:crypto')
let fs = require('node:fs')
let http = require('node:http')
let path = require('node:path')
let { spawn } = require('node:child_process')
let codec = require('../codec')

let EP = process.argv[2] || 'hub75-01.local:7575'
let CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
let TOLERANCE = 4   // per channel; two GL implementations are not required to be bit identical

let passed = 0, failed = 0
let check = (name, ok, detail) => {
  if (ok) { passed++; console.log('  PASS  ' + name) }
  else { failed++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + detail : '')) }
}
let sleep = (ms) => new Promise(r => setTimeout(r, ms))
let hash = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16)

// ---- fixtures ---------------------------------------------------------------------------------

// A 1d lut with a hard step in it: linear filtering across the step is exactly where two
// implementations disagree if one of them got the texel centres or the wrap mode wrong.
let lut1d = () => {
  let b = Buffer.alloc(256 * 4)
  for (let i = 0; i < 256; i++) {
    b[i * 4] = i
    b[i * 4 + 1] = i < 128 ? 255 : 0
    b[i * 4 + 2] = (i * 7) & 255
    b[i * 4 + 3] = 255
  }
  return b
}

let lut3d = (size) => {
  let b = Buffer.alloc(size * size * size * 4)
  let i = 0
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    b[i++] = Math.round(x * 255 / (size - 1))
    b[i++] = Math.round(y * 255 / (size - 1))
    b[i++] = Math.round(z * 255 / (size - 1))
    b[i++] = 255
  }
  return b
}

let fixtures = [
  {
    name: 'a plain chain: gradients and a live uniform',
    uniforms: [[0.5, 0.25, 0.75, 1]],
    textures: [],
    frag: `#version 300 es
precision highp float;
in vec2 fragCoord;
out vec4 fragColor;
uniform vec4 u_vs0;
void main() {
  vec4 v0 = vec4(fragCoord, 0.0, 1.0);
  vec4 v1 = v0 * u_vs0;
  fragColor = vec4(v1.x + 0.5, v1.y + 0.5, u_vs0.z, 1.0);
}
`,
  },
  {
    // The lut path, and the u_vsex == (0,0) guard: if the display reported real extents here,
    // the tex node's aspect correction would kick in and the picture would shift.
    name: 'a tex1d chain: lut upload, LINEAR filtering and the u_vsex rule',
    uniforms: [[1, 0, 0, 1]],
    textures: [{ dims: 1, size: 256, data: lut1d() }],
    frag: `#version 300 es
precision highp float;
in vec2 fragCoord;
out vec4 fragColor;
uniform vec4 u_vs0;
uniform sampler2D u_vstex0;
uniform vec2 u_vsex0;
void main() {
  vec4 v0 = vec4(fragCoord, 0.0, 1.0);
  vec2 uv = vec2(v0.x * 0.25 + 0.5, 0.5);
  if (u_vsex0.y > 0.0) { uv.x *= u_vsex0.x / u_vsex0.y; }
  vec4 v1 = texture(u_vstex0, uv) * u_vs0;
  fragColor = vec4(v1.rgb, 1.0);
}
`,
  },
  {
    // sampler3D end to end: the feature the older VideoCore IV could not do at all, and the one
    // tools/egl-probe.c was written to settle.
    name: 'a tex3d chain: sampler3D, RGBA8 3D upload and trilinear filtering',
    uniforms: [[0.5, 0, 0, 1]],
    textures: [{ dims: 3, size: 16, data: lut3d(16) }],
    frag: `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 fragCoord;
out vec4 fragColor;
uniform vec4 u_vs0;
uniform sampler3D u_vstex0;
uniform vec2 u_vsex0;
void main() {
  vec4 v0 = vec4(fragCoord, 0.0, 1.0);
  vec3 p = vec3(v0.x * 0.25 + 0.5, v0.y * 0.5 + 0.5, u_vs0.x);
  fragColor = vec4(texture(u_vstex0, p).rgb, 1.0);
}
`,
  },
]

// ---- the browser side --------------------------------------------------------------------------

let renderInBrowser = (job) => new Promise((resolve, reject) => {
  let page = fs.readFileSync(path.join(__dirname, 'pixel-check.html'))
  let done = null
  let server = http.createServer((req, res) => {
    if (req.url === '/job') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(job))
    }
    if (req.url === '/result' && req.method === 'POST') {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        res.writeHead(204).end()
        done(JSON.parse(body))
      })
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(page)
  })
  server.listen(0, () => {
    let port = server.address().port
    // A fresh profile per run: a shared one caches the page, and this server sends no
    // Cache-Control, so a later fixture would quietly render an earlier one's shader.
    let profile = `/tmp/limut-pixelcheck-${process.pid}-${port}`
    let chrome = spawn(CHROME, [
      '--headless=new', '--no-first-run', '--no-default-browser-check',
      '--use-gl=angle', '--enable-unsafe-swiftshader',
      '--user-data-dir=' + profile,
      `http://localhost:${port}/`,
    ], { stdio: 'ignore' })
    let finish = (fn) => (v) => {
      clearTimeout(timer)
      chrome.kill()
      server.close()
      try { fs.rmSync(profile, { recursive: true, force: true }) } catch (e) {}
      fn(v)
    }
    let timer = setTimeout(() => finish(reject)(new Error('the browser did not report back')), 30000)
    done = (r) => (r.error ? finish(reject)(new Error('browser: ' + r.error)) : finish(resolve)(r))
  })
})

// ---- the display side ---------------------------------------------------------------------------

let drive = async (job) => {
  let s = new WebSocket(`ws://${EP}/session`)
  s.binaryType = 'arraybuffer'
  let queue = [], waiters = []
  s.addEventListener('message', (e) => {
    if (typeof e.data !== 'string') { return }
    let m = JSON.parse(e.data)
    if (m.type === 'stat') { return }
    let w = waiters.shift()
    if (w) { w(m) } else { queue.push(m) }
  })
  let next = () => queue.length ? Promise.resolve(queue.shift())
    : new Promise((res, rej) => {
      let t = setTimeout(() => rej(new Error('timed out waiting for the display')), 5000)
      waiters.push(m => { clearTimeout(t); res(m) })
    })
  await new Promise((res, rej) => {
    s.addEventListener('open', res)
    s.addEventListener('error', () => rej(new Error(`cannot reach the display at ${EP}`)))
  })
  s.send(JSON.stringify({ type: 'hello', proto: 1, client: 'pixel-check', takeover: true }))
  await next()

  // Anything left bound from a previous fixture would still be showing if this one failed to
  // bind, and the comparison would then pass or fail against the wrong picture.
  s.send(JSON.stringify({ type: 'test', pattern: 'off' }))
  s.send(JSON.stringify({ type: 'unlayer', id: 0 }))

  let textures = []
  for (let i = 0; i < job.textures.length; i++) {
    let t = job.textures[i]
    let data = Buffer.from(t.data, 'base64')
    let id = hash(data)
    let chunks = Math.max(1, Math.ceil(data.length / codec.CHUNK_SIZE))
    s.send(JSON.stringify({ type: 'asset', id, kind: 'lut', dims: t.dims, size: t.size,
                            bytes: data.length, chunks }))
    for (let k = 0; k < chunks; k++) {
      s.send(codec.encodeChunk(k, data.subarray(k * codec.CHUNK_SIZE, (k + 1) * codec.CHUNK_SIZE)))
    }
    let m = await next()
    if (m.type !== 'assetok') { throw new Error('asset rejected: ' + JSON.stringify(m)) }
    textures.push({ unit: i, sampler: t.dims === 3 ? 'sampler3D' : 'sampler2D', asset: id })
  }

  let id = hash(Buffer.from(job.frag, 'utf8'))
  s.send(JSON.stringify({ type: 'prog', id, frag: job.frag,
                          uniforms: job.uniforms.map((_, i) => 'u_vs' + i) }))
  let m = await next()
  if (m.type !== 'progok') { throw new Error('program rejected: ' + JSON.stringify(m)) }
  s.send(JSON.stringify({ type: 'layer', id: 0, prog: id, textures }))
  s.send(codec.encodeFrame({ seq: Date.now() & 0x7fffffff, dim: 1, beat: 0, hostTime: 0,
                             layers: [{ id: 0, uniforms: job.uniforms }] }))
  await sleep(300)

  let res = await fetch(`http://${EP}/frame.raw`)
  let px = Buffer.from(await res.arrayBuffer())
  s.close()
  return { px, gamma: parseFloat(res.headers.get('x-gamma')) }
}

// ---- comparison ------------------------------------------------------------------------------

let compare = (name, w, h, a, b) => {
  let worst = 0, worstAt = null, bad = 0
  for (let i = 0; i < w * h; i++) {
    for (let ch = 0; ch < 3; ch++) {   // alpha is forced opaque by the output stage
      let d = Math.abs(a[i * 4 + ch] - b[i * 4 + ch])
      if (d > worst) { worst = d; worstAt = { x: i % w, y: (i / w) | 0, ch } }
    }
    let dr = Math.abs(a[i * 4] - b[i * 4])
    let dg = Math.abs(a[i * 4 + 1] - b[i * 4 + 1])
    let db = Math.abs(a[i * 4 + 2] - b[i * 4 + 2])
    if (dr > TOLERANCE || dg > TOLERANCE || db > TOLERANCE) { bad++ }
  }
  let where = worstAt
    ? `worst ${worst} at (${worstAt.x},${worstAt.y}) ch${worstAt.ch}: ` +
      `browser ${a[(worstAt.y * w + worstAt.x) * 4 + worstAt.ch]} ` +
      `display ${b[(worstAt.y * w + worstAt.x) * 4 + worstAt.ch]}`
    : ''
  check(name, bad === 0, `${bad}/${w * h} pixels differ by more than ${TOLERANCE}; ${where}`)
  if (bad === 0) { console.log(`          (worst channel difference ${worst})`) }
}

// A picture that is uniformly black would compare equal to another uniformly black picture, so
// every fixture has to be shown to have actually drawn something.
let notBlank = (px, w, h) => {
  let first = px.readUInt32LE(0)
  for (let i = 1; i < w * h; i++) if (px.readUInt32LE(i * 4) !== first) return true
  return false
}

let run = async () => {
  let info = await (await fetch(`http://${EP}/info`)).json()
  let w = info.display.w, h = info.display.h
  let har = w / h
  console.log(`display ${info.name} at ${EP}: ${w}x${h}, ${info.gl.renderer}`)
  console.log(`aspect ${har.toFixed(2)}:1 — ${(har > 2 || har < 0.5)
    ? 'the sqrt softening in §13 applies here' : 'no aspect softening at this ratio'}\n`)

  for (let f of fixtures) {
    console.log(f.name)
    let job = {
      w, h, frag: f.frag, uniforms: f.uniforms,
      textures: f.textures.map(t => ({ dims: t.dims, size: t.size, data: t.data.toString('base64') })),
    }
    let browser, display
    try { browser = await renderInBrowser(job) } catch (e) { check(f.name, false, String(e.message)); continue }
    try { display = await drive(job) } catch (e) { check(f.name, false, String(e.message)); continue }
    if (display.gamma !== 1) {
      check(f.name, false, `the display is running with gamma ${display.gamma}; restart it with --gamma 1`)
      return finish()
    }
    let a = Buffer.from(browser.pixels, 'base64')
    check('  the browser drew something', notBlank(a, w, h))
    check('  the display drew something', notBlank(display.px, w, h))
    compare('  the display matches the browser', w, h, a, display.px)
  }
  finish()
}

let finish = () => {
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

run().catch(e => { console.error('\n🔴 pixel-check crashed:', e && e.stack || e); process.exit(1) })
