'use strict'
// A fake HUB75 display that speaks the limut display protocol (draw/hub75/PROTOCOL.md).
//
// It exists so the limut host side can be built and tested before the Colorlight card and the
// panels arrive. It implements everything the real Pi renderer must implement except the two
// parts that need hardware: actually rendering the shader, and pushing pixels to the card.
// Everything else — discovery, session lifecycle, the asset and program caches, error reporting,
// the dimmer, frame pacing and drop accounting — is real.
//
//   node draw/hub75/mock/display.js --name hub75-01 --size 128x64 --verbose
//
// Zero dependencies, on purpose: see mock/README.md.

let http = require('node:http')
let crypto = require('node:crypto')
let os = require('node:os')
let { spawnSync } = require('node:child_process')
let ws = require('./ws-server')
let codec = require('../codec')

let PROTO = 1

// ---- arguments ----------------------------------------------------------------------------

let parseArgs = (argv) => {
  let a = { port: 7575, name: 'hub75-01', w: 128, h: 64, failCompile: null, drop: 0, verbose: false }
  for (let i = 0; i < argv.length; i++) {
    let k = argv[i]
    let v = argv[i + 1]
    if (k === '--port') { a.port = parseInt(v, 10); i++ }
    else if (k === '--name') { a.name = v; i++ }
    else if (k === '--size') {
      let m = /^(\d+)x(\d+)$/.exec(v || '')
      if (!m) { throw new Error('--size wants WxH, eg 128x64') }
      a.w = parseInt(m[1], 10); a.h = parseInt(m[2], 10); i++
    }
    else if (k === '--fail-compile') { a.failCompile = v; i++ }
    else if (k === '--drop') { a.drop = parseFloat(v); i++ }
    else if (k === '--verbose' || k === '-v') { a.verbose = true }
    else if (k === '--help' || k === '-h') { a.help = true }
    else { throw new Error('unknown argument ' + k) }
  }
  return a
}

let usage = `limut HUB75 mock display

  --port N            listen port (default 7575)
  --name NAME         display name reported by /info and welcome (default hub75-01)
  --size WxH          panel resolution (default 128x64)
  --fail-compile STR  reject any shader whose source contains STR, to exercise the error path
  --drop PCT          randomly discard PCT% of incoming frame packets
  --verbose, -v       log every message instead of a one line status
`

// ---- shader checking ----------------------------------------------------------------------

// If glslangValidator happens to be installed, use it: real GLSL errors beat simulated ones, and
// this mock's whole job is to be honest about what the Pi will say back.
let haveGlslang = (() => {
  try { return spawnSync('glslangValidator', ['--version'], { stdio: 'ignore' }).status === 0 }
  catch (e) { return false }
})()

let glslangCheck = (frag) => {
  let r = spawnSync('glslangValidator', ['--stdin', '-S', 'frag'], { input: frag, encoding: 'utf8' })
  if (r.status === 0) { return null }
  return (r.stdout || '').trim() || (r.stderr || '').trim() || 'glslangValidator failed'
}

// Checks that hold whether or not a real compiler is available. These catch the host bugs that
// matter most: a declared uniform list that does not match the source is a silent wrong-picture
// bug at runtime, because uniform slot index is positional (PROTOCOL.md §7.1).
let checkProgram = (frag, uniforms) => {
  let problems = []
  if (!/^#version 300 es\b/.test(frag)) { problems.push('source must begin with #version 300 es') }
  if (!/\bvoid\s+main\s*\(/.test(frag)) { problems.push('no main()') }
  if (!/\bout\s+vec4\s+fragColor\b/.test(frag)) { problems.push('no `out vec4 fragColor` declaration') }
  if (!/\bin\s+vec2\s+fragCoord\b/.test(frag)) { problems.push('no `in vec2 fragCoord` declaration') }
  let declared = (frag.match(/uniform\s+vec4\s+(u_vs\d+)\s*;/g) || []).map(s => /(u_vs\d+)/.exec(s)[1])
  let named = uniforms || []
  if (declared.join(',') !== named.join(',')) {
    problems.push(`uniform list [${named.join(', ')}] does not match the source's [${declared.join(', ')}]`)
  }
  return problems.length ? problems.join('\n') : null
}

// Sampler declarations live in the source, but which texture fills each unit is a property of the
// layer, not the program (PROTOCOL.md §7.2) — so this is checked at bind time, not compile time.
let declaredSamplers = (frag) => {
  let out = []
  let re = /uniform\s+(sampler2D|sampler3D)\s+u_vstex(\d+)\s*;/g
  let m
  while ((m = re.exec(frag)) !== null) { out[parseInt(m[2], 10)] = m[1] }
  return out
}

let checkTextures = (frag, textures) => {
  let declared = declaredSamplers(frag)
  let given = []
  ;(textures || []).forEach(t => { given[t.unit] = t.sampler || 'sampler2D' })
  if (declared.length !== given.length) {
    return `shader declares ${declared.length} texture unit(s), the layer binds ${given.length}`
  }
  for (let i = 0; i < declared.length; i++) {
    if (declared[i] !== given[i]) {
      return `texture unit ${i}: shader declares ${declared[i] || 'nothing'}, the layer binds ${given[i] || 'nothing'}`
    }
  }
  return null
}

// ---- display ------------------------------------------------------------------------------

let hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)

let makeDisplay = (opts) => {
  let d = {
    opts: opts,
    assets: new Map(), // id -> {kind, dims, size, data}
    progs: new Map(), // id -> {frag, uniforms, textures, ok, log}
    layer: null, // {id, prog}
    dim: 1,
    testPattern: 'off',
    session: null, // {conn, name, id}
    sessions: 0,
    pending: null, // asset being received
    frame: null, // latest undrawn frame packet
    lastSeq: -1,
    stats: { rendered: 0, dropped: 0, stale: 0, fps: 0 },
  }

  let log = (...args) => { if (opts.verbose) { console.log(...args) } }

  let sendErr = (conn, kind, id, msg) => {
    log('  -> error', kind, id || '', msg)
    conn.sendJson({ type: 'error', kind: kind, id: id, log: msg })
  }

  // A protocol error means the two ends disagree about state; PROTOCOL.md §8 closes the session
  // rather than limping on, so the bug is visible rather than showing a wrong picture.
  let protocolError = (conn, msg) => {
    sendErr(conn, 'protocol', undefined, msg)
    conn.close(1002, 'protocol')
  }

  d.info = () => ({
    proto: PROTO,
    name: opts.name,
    display: { w: opts.w, h: opts.h },
    gl: {
      version: 'mock (node ' + process.versions.node + ' on ' + os.platform() + ')',
      renderer: haveGlslang ? 'mock display, glslangValidator available' : 'mock display, structural checks only',
      maxTextureSize: 4096, // what the real V3D reports, so host side limits get exercised
    },
    busy: d.session !== null,
  })

  d.compile = (msg) => {
    let cached = d.progs.get(msg.id)
    if (cached) {
      // The uniform list is a pure function of the source, so if the same source arrives with a
      // different list the host's codegen and its own bookkeeping disagree
      if ((cached.uniforms || []).join(',') !== (msg.uniforms || []).join(',')) {
        return { ok: false, log: `program ${msg.id} was already sent with uniforms [${cached.uniforms.join(', ')}]`, transient: true }
      }
      return cached
    }
    let entry = { frag: msg.frag, uniforms: msg.uniforms || [], ok: false, log: null }
    let want = hash(Buffer.from(msg.frag, 'utf8'))
    if (want !== msg.id) {
      entry.log = `program id ${msg.id} does not match the hash of its source (${want})`
    } else if (opts.failCompile && msg.frag.indexOf(opts.failCompile) !== -1) {
      entry.log = `ERROR: 0:1: injected failure (--fail-compile ${JSON.stringify(opts.failCompile)})`
    } else {
      entry.log = checkProgram(msg.frag, msg.uniforms) || (haveGlslang ? glslangCheck(msg.frag) : null)
    }
    entry.ok = entry.log === null
    d.progs.set(msg.id, entry) // cached either way: a failure is permanent, exactly as on the host
    return entry
  }

  d.handleText = (conn, text) => {
    let msg
    try { msg = JSON.parse(text) } catch (e) { return protocolError(conn, 'malformed JSON') }
    if (typeof msg !== 'object' || msg === null || typeof msg.type !== 'string') {
      return protocolError(conn, 'message needs a string `type`')
    }
    log('<-', text.length > 400 ? text.slice(0, 400) + `... (${text.length}B)` : text)

    if (msg.type === 'hello') { return d.handleHello(conn, msg) }
    if (d.session === null || d.session.conn !== conn) {
      return protocolError(conn, 'first message must be hello')
    }

    switch (msg.type) {
      case 'have': {
        let missing = (msg.ids || []).filter(id => !d.assets.has(id) && !d.progs.has(id))
        conn.sendJson({ type: 'have', missing: missing })
        break
      }
      case 'asset': {
        if (d.pending) { return protocolError(conn, 'an asset is already in flight') }
        if (typeof msg.id !== 'string' || !(msg.bytes >= 0)) { return protocolError(conn, 'bad asset announce') }
        if (msg.kind !== 'lut' && msg.kind !== 'image') {
          return sendErr(conn, 'asset', msg.id, `unsupported asset kind ${msg.kind}`)
        }
        let expectChunks = Math.max(1, Math.ceil(msg.bytes / codec.CHUNK_SIZE))
        if (msg.chunks !== expectChunks) {
          return sendErr(conn, 'asset', msg.id, `chunks ${msg.chunks} does not match ${msg.bytes} bytes (expected ${expectChunks})`)
        }
        d.pending = { msg: msg, parts: [], next: 0, got: 0 }
        break
      }
      case 'prog': {
        if (typeof msg.id !== 'string' || typeof msg.frag !== 'string') {
          return protocolError(conn, 'bad prog message')
        }
        let entry = d.compile(msg)
        if (entry.ok) { conn.sendJson({ type: 'progok', id: msg.id }) }
        else { sendErr(conn, 'compile', msg.id, entry.log) }
        break
      }
      case 'layer': {
        if (msg.id !== 0) { return protocolError(conn, `proto ${PROTO} supports layer 0 only, got ${msg.id}`) }
        let prog = d.progs.get(msg.prog)
        // Ordered delivery means a layer naming an unknown program is a real host bug, not a
        // race: the prog message would have arrived first. Fail loudly (PROTOCOL.md §7.2).
        if (!prog) { return protocolError(conn, `layer names program ${msg.prog}, which was never sent`) }
        if (!prog.ok) { return sendErr(conn, 'compile', msg.prog, prog.log) }
        let textures = msg.textures || []
        let missing = textures.filter(t => !d.assets.has(t.asset))
        if (missing.length) {
          return sendErr(conn, 'asset', msg.prog, 'layer needs assets not in the cache: ' + missing.map(t => t.asset).join(', '))
        }
        let texProblem = checkTextures(prog.frag, textures)
        if (texProblem) { return protocolError(conn, texProblem) }
        d.layer = { id: msg.id, prog: msg.prog, textures: textures }
        break
      }
      case 'unlayer': {
        if (d.layer && d.layer.id === msg.id) { d.layer = null }
        break
      }
      case 'dim': {
        d.dim = Math.max(0, Math.min(1, Number(msg.v)))
        break
      }
      case 'test': {
        if (['bars', 'grid', 'off'].indexOf(msg.pattern) === -1) {
          return protocolError(conn, `unknown test pattern ${msg.pattern}`)
        }
        d.testPattern = msg.pattern
        break
      }
      case 'bye': {
        conn.sendJson({ type: 'closed', reason: 'bye' })
        conn.close(1000, 'bye')
        break
      }
      default: break // unknown types are ignored, for forward compatibility (PROTOCOL.md §5.2)
    }
  }

  d.handleHello = (conn, msg) => {
    if (msg.proto !== PROTO) {
      conn.sendJson({ type: 'closed', reason: 'proto' })
      return conn.close(1002, 'proto')
    }
    if (d.session && d.session.conn !== conn) {
      if (!msg.takeover) {
        conn.sendJson({ type: 'closed', reason: 'busy' })
        return conn.close(1000, 'busy')
      }
      let old = d.session
      d.session = null
      old.conn.sendJson({ type: 'closed', reason: 'takeover' })
      old.conn.close(1000, 'takeover')
      log(`  session ${old.id} displaced by takeover`)
    }
    // Caches deliberately survive the session change: they are content addressed, so a browser
    // reload costs a `have` round trip rather than re-uploading every texture.
    d.session = { conn: conn, name: msg.name || 'anonymous', id: 's' + (++d.sessions) }
    d.lastSeq = -1
    conn.sendJson({
      type: 'welcome',
      proto: PROTO,
      session: d.session.id,
      name: opts.name,
      display: { w: opts.w, h: opts.h },
      gl: d.info().gl,
    })
    log(`  session ${d.session.id} opened by ${d.session.name}`)
  }

  d.handleBinary = (conn, buf) => {
    if (d.session === null || d.session.conn !== conn) {
      return protocolError(conn, 'binary packet before hello')
    }
    let bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    let type = codec.packetType(bytes)
    if (type === codec.PACKET_FRAME) { return d.handleFrame(conn, bytes) }
    if (type === codec.PACKET_CHUNK) { return d.handleChunk(conn, bytes) }
    return protocolError(conn, 'unknown binary packet type 0x' + type.toString(16))
  }

  d.handleFrame = (conn, bytes) => {
    let f
    try { f = codec.decodeFrame(bytes) } catch (e) { return protocolError(conn, e.message) }
    if (opts.drop > 0 && Math.random() * 100 < opts.drop) {
      d.stats.dropped++
      return
    }
    if (f.seq <= d.lastSeq) { d.stats.stale++; return } // reordered, eg straight after a reconnect
    d.lastSeq = f.seq
    if (f.layerCount > 1) { return protocolError(conn, `proto ${PROTO} allows at most one layer`) }
    if (f.layerCount === 1) {
      let l = f.layers[0]
      if (!d.layer) { return protocolError(conn, 'frame carries a layer but none is bound') }
      let prog = d.progs.get(d.layer.prog)
      if (l.uniformCount !== prog.uniforms.length) {
        // Positional slots (PROTOCOL.md §12.1): a mismatch means the ends disagree about which
        // program is bound, which would silently render with the wrong values
        return protocolError(conn, `frame has ${l.uniformCount} uniforms, program ${d.layer.prog} declares ${prog.uniforms.length}`)
      }
    }
    d.dim = Math.max(0, Math.min(1, f.dim))
    // Last write wins: an undrawn frame that a newer one supersedes is dropped, not queued
    if (d.frame !== null) { d.stats.dropped++ }
    d.frame = f
  }

  d.handleChunk = (conn, bytes) => {
    let c
    try { c = codec.decodeChunk(bytes) } catch (e) { return protocolError(conn, e.message) }
    let p = d.pending
    if (!p) { return sendErr(conn, 'asset', undefined, 'chunk with no asset announced') }
    if (c.index !== p.next) {
      d.pending = null
      return sendErr(conn, 'asset', p.msg.id, `chunk out of order: expected ${p.next}, got ${c.index}`)
    }
    p.parts.push(Buffer.from(c.payload))
    p.got += c.payload.length
    p.next++
    if (p.next < p.msg.chunks) { return }

    d.pending = null
    let data = Buffer.concat(p.parts)
    if (data.length !== p.msg.bytes) {
      return sendErr(conn, 'asset', p.msg.id, `asset is ${data.length} bytes, announce said ${p.msg.bytes}`)
    }
    let got = hash(data)
    if (got !== p.msg.id) {
      return sendErr(conn, 'asset', p.msg.id, `content hash is ${got}, announce said ${p.msg.id}`)
    }
    if (p.msg.kind === 'lut') {
      // dims/size are structural, and a lut whose byte count disagrees with them would be
      // uploaded with the wrong stride and show as garbage rather than as an error
      let texels = p.msg.dims === 1 ? p.msg.size : p.msg.dims === 2 ? p.msg.size * p.msg.size : p.msg.size ** 3
      if (data.length !== texels * 4) {
        return sendErr(conn, 'asset', p.msg.id, `lut ${p.msg.dims}d size ${p.msg.size} needs ${texels * 4} bytes, got ${data.length}`)
      }
      if (p.msg.size > 4096) {
        return sendErr(conn, 'asset', p.msg.id, `lut size ${p.msg.size} exceeds maxTextureSize 4096`)
      }
    }
    d.assets.set(p.msg.id, { kind: p.msg.kind, dims: p.msg.dims, size: p.msg.size, data: data })
    log(`  cached asset ${p.msg.id} (${p.msg.kind}, ${data.length}B)`)
    conn.sendJson({ type: 'assetok', id: p.msg.id })
  }

  // Stands in for the render + readback + Colorlight output pass. Consuming exactly one frame per
  // tick is what makes the drop accounting meaningful: it is the real behaviour of a display that
  // cannot draw faster than its own cadence.
  d.tick = () => {
    if (d.frame === null) { return }
    d.frame = null
    d.stats.rendered++
  }

  d.onClose = (conn) => {
    if (d.session && d.session.conn === conn) {
      log(`  session ${d.session.id} closed`)
      d.session = null
      d.pending = null
    }
  }

  return d
}

// ---- server -------------------------------------------------------------------------------

let start = (opts) => {
  let d = makeDisplay(opts)

  let server = http.createServer((req, res) => {
    let url = (req.url || '').split('?')[0]
    // Without CORS the browser's discovery probe fails opaquely (PROTOCOL.md §4)
    let headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
    if (url === '/info') {
      res.writeHead(200, headers)
      res.end(JSON.stringify(d.info(), null, 2) + '\n')
    } else {
      res.writeHead(404, headers)
      res.end('{"error":"not found"}\n')
    }
  })

  ws.attach(server, '/session', (conn) => {
    conn.onMessage = (data, isBinary) => {
      try {
        if (isBinary) { d.handleBinary(conn, data) } else { d.handleText(conn, data) }
      } catch (e) {
        console.error('🔴 handler error:', e && e.stack || e)
        try { conn.close(1011, 'internal error') } catch (e2) {}
      }
    }
    conn.onClose = () => d.onClose(conn)
  })

  let lastRendered = 0
  let renderTimer = setInterval(d.tick, 1000 / 60)
  let statTimer = setInterval(() => {
    let rendered = d.stats.rendered
    d.stats.fps = rendered - lastRendered
    lastRendered = rendered
    if (d.session) {
      d.session.conn.sendJson({
        type: 'stat',
        fps: d.stats.fps,
        rendered: d.stats.rendered,
        dropped: d.stats.dropped,
        renderMs: 0,
        seq: d.lastSeq,
        temp: 0,
        throttled: 0,
      })
      d.session.conn.ping()
    }
    status()
  }, 1000)

  let status = () => {
    if (opts.verbose || !process.stdout.isTTY) { return }
    let f = d.layer ? d.layer.prog.slice(0, 8) : (d.testPattern !== 'off' ? d.testPattern : '—')
    let line = `hub75 ${opts.name} ${opts.w}x${opts.h}  ` +
      `${d.session ? d.session.id + ':' + d.session.name : 'no session'}  ` +
      `seq ${d.lastSeq}  ${d.stats.fps}fps  drop ${d.stats.dropped}  dim ${d.dim.toFixed(2)}  ` +
      `layer ${f}  assets ${d.assets.size}  progs ${d.progs.size}`
    process.stdout.write('\r' + line.padEnd(process.stdout.columns ? process.stdout.columns - 1 : 120).slice(0, 200))
  }

  server.listen(opts.port, () => {
    console.log(`limut HUB75 mock display "${opts.name}" ${opts.w}x${opts.h} on port ${opts.port}`)
    console.log(`  info    http://localhost:${opts.port}/info`)
    console.log(`  session ws://localhost:${opts.port}/session`)
    console.log(`  shaders ${haveGlslang ? 'checked with glslangValidator' : 'structural checks only (glslangValidator not on PATH)'}`)
    if (opts.failCompile) { console.log(`  injecting compile failures for sources containing ${JSON.stringify(opts.failCompile)}`) }
    if (opts.drop) { console.log(`  dropping ${opts.drop}% of frame packets`) }
  })

  let stop = () => { clearInterval(renderTimer); clearInterval(statTimer); server.close() }
  return { server, display: d, stop }
}

if (require.main === module) {
  let opts
  try { opts = parseArgs(process.argv.slice(2)) }
  catch (e) { console.error('🔴 ' + e.message + '\n\n' + usage); process.exit(2) }
  if (opts.help) { console.log(usage); process.exit(0) }
  start(opts)
}

module.exports = { start, makeDisplay, parseArgs, PROTO, hash, checkProgram, checkTextures }
