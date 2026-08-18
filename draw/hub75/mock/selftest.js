'use strict'
// Scripted client that drives the mock display through every path in draw/hub75/PROTOCOL.md,
// including the ones that only ever happen when something has gone wrong.
//
//   node draw/hub75/mock/selftest.js
//
// The client is Node's built-in WebSocket (Node 18+), which is the same standards implementation
// a browser uses. That matters: it means these tests exercise the hand-rolled server in
// ws-server.js against a real client, not against a matching hand-rolled one.

let crypto = require('node:crypto')
let { start } = require('./display')
let codec = require('../codec')

let passed = 0
let failed = 0
let check = (name, ok, detail) => {
  if (ok) { passed++; console.log(`  PASS  ${name}`) }
  else { failed++; console.log(`  FAIL  ${name}${detail !== undefined ? '\n          ' + detail : ''}`) }
}
let eq = (name, expected, actual) => {
  let x = JSON.stringify(expected)
  let a = JSON.stringify(actual)
  check(name, x === a, x === a ? undefined : `expected ${x}\n          actual   ${a}`)
}

let hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)

// ---- test client --------------------------------------------------------------------------

let connect = (port) => new Promise((resolve, reject) => {
  let sock = new WebSocket(`ws://localhost:${port}/session`)
  sock.binaryType = 'arraybuffer'
  let queue = []
  let waiters = []
  let deliver = (m) => {
    let w = waiters.shift()
    if (w) { w(m) } else { queue.push(m) }
  }
  sock.addEventListener('message', (e) => {
    if (typeof e.data === 'string') { deliver(JSON.parse(e.data)) }
    else { deliver({ type: '(binary)', bytes: new Uint8Array(e.data) }) }
  })
  sock.addEventListener('close', (e) => deliver({ type: '(closed)', code: e.code, reason: e.reason }))
  sock.addEventListener('error', () => {})
  let c = {
    sock: sock,
    send: (obj) => sock.send(JSON.stringify(obj)),
    sendBin: (bytes) => sock.send(bytes),
    // Waits for the next message, ignoring the ~1Hz stat heartbeat so tests never race it
    next: (timeoutMs) => new Promise((res, rej) => {
      let take = () => {
        while (queue.length) {
          let m = queue.shift()
          if (m.type !== 'stat') { return res(m) }
        }
        let t = setTimeout(() => rej(new Error('timed out waiting for a message')), timeoutMs || 2000)
        waiters.push((m) => {
          clearTimeout(t)
          if (m.type === 'stat') { take() } else { res(m) }
        })
      }
      take()
    }),
    close: () => sock.close(),
  }
  sock.addEventListener('open', () => resolve(c))
  sock.addEventListener('error', (e) => reject(new Error('connect failed')))
})

let hello = async (port, opts) => {
  let c = await connect(port)
  c.send(Object.assign({ type: 'hello', proto: 1, client: 'selftest', name: 'selftest' }, opts || {}))
  c.welcome = await c.next()
  return c
}

let sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ---- fixtures -----------------------------------------------------------------------------

// A realistic generated shader: exactly the shape draw/visualsynth/codegen.js emits
let fragFor = (uniformNames, texNames) => `#version 300 es
precision highp float;
in vec2 fragCoord;
out vec4 fragColor;
${uniformNames.map(n => `uniform vec4 ${n};`).join('\n')}
${(texNames || []).map((n, i) => `uniform sampler2D ${n};\nuniform vec2 u_vsex${i};`).join('\n')}
void main() {
  vec4 v0 = vec4(fragCoord, 0.0, 1.0);
  vec4 v1 = ${uniformNames.length ? `v0 * ${uniformNames[0]}` : 'v0'};
  fragColor = v1;
}`

let progMsg = (uniformNames, samplers) => {
  let texNames = (samplers || []).map((s, i) => 'u_vstex' + i)
  let frag = fragFor(uniformNames, texNames)
  return { type: 'prog', id: hash(Buffer.from(frag, 'utf8')), frag: frag, uniforms: uniformNames }
}

// A 2d lut big enough to need several chunks: 96*96*4 = 36864 bytes = 3 chunks
let lutData = (dims, size) => {
  let texels = dims === 1 ? size : dims === 2 ? size * size : size * size * size
  let b = Buffer.alloc(texels * 4)
  for (let i = 0; i < texels; i++) { b[i * 4] = i & 255; b[i * 4 + 1] = (i >> 8) & 255; b[i * 4 + 3] = 255 }
  return b
}

let sendAsset = async (c, kind, data, dims, size) => {
  let id = hash(data)
  let chunks = Math.max(1, Math.ceil(data.length / codec.CHUNK_SIZE))
  c.send({ type: 'asset', id: id, kind: kind, dims: dims, size: size, bytes: data.length, chunks: chunks })
  for (let i = 0; i < chunks; i++) {
    c.sendBin(codec.encodeChunk(i, data.subarray(i * codec.CHUNK_SIZE, (i + 1) * codec.CHUNK_SIZE)))
  }
  return id
}

// ---- tests --------------------------------------------------------------------------------

let run = async () => {
  let main = start({ port: 7591, name: 'mock-a', w: 128, h: 64, drop: 0, verbose: false, failCompile: null })
  await sleep(50)

  console.log('\ndiscovery')
  {
    let res = await fetch('http://localhost:7591/info')
    let info = await res.json()
    eq('/info reports proto 1', 1, info.proto)
    eq('/info reports the display name', 'mock-a', info.name)
    eq('/info reports panel size', { w: 128, h: 64 }, info.display)
    eq('/info sets CORS, without which a browser probe fails opaquely',
      '*', res.headers.get('access-control-allow-origin'))
    eq('/info reports not busy before any session', false, info.busy)
    eq('unknown path 404s', 404, (await fetch('http://localhost:7591/nope')).status)
  }

  console.log('\nsession handshake')
  {
    let c = await hello(7591)
    eq('welcome carries proto, name and size',
      { type: 'welcome', proto: 1, name: 'mock-a', display: { w: 128, h: 64 } },
      { type: c.welcome.type, proto: c.welcome.proto, name: c.welcome.name, display: c.welcome.display })
    check('welcome carries a session id', typeof c.welcome.session === 'string')
    check('welcome reports GL capabilities', typeof c.welcome.gl.maxTextureSize === 'number')
    let info = await (await fetch('http://localhost:7591/info')).json()
    eq('/info reports busy while a session is open', true, info.busy)
    c.close()
    await sleep(60)
  }
  {
    let c = await connect(7591)
    c.send({ type: 'hello', proto: 99 })
    eq('a proto mismatch is refused', { type: 'closed', reason: 'proto' }, await c.next())
  }
  {
    let c = await connect(7591)
    c.send({ type: 'prog', id: 'x', frag: '' })
    let m = await c.next()
    eq('a message before hello is a protocol error', 'protocol', m.kind)
  }

  console.log('\nassets')
  let c = await hello(7591)
  let lut2d, lut3d
  {
    lut2d = await sendAsset(c, 'lut', lutData(2, 96), 2, 96)
    let m = await c.next()
    eq('a multi-chunk lut is reassembled and acked', { type: 'assetok', id: lut2d }, m)

    lut3d = await sendAsset(c, 'lut', lutData(3, 16), 3, 16)
    eq('a 3d lut is accepted', 'assetok', (await c.next()).type)

    c.send({ type: 'have', ids: [lut2d, 'deadbeefdeadbeef'] })
    eq('have reports only what is missing', { type: 'have', missing: ['deadbeefdeadbeef'] }, await c.next())
  }
  {
    let data = lutData(1, 256)
    c.send({ type: 'asset', id: 'ffffffffffffffff', kind: 'lut', dims: 1, size: 256, bytes: data.length, chunks: 1 })
    c.sendBin(codec.encodeChunk(0, data))
    let m = await c.next()
    eq('a content hash mismatch is reported', 'asset', m.kind)
    check('the hash error names both hashes', /content hash is [0-9a-f]{16}, announce said ffffffffffffffff/.test(m.log), m.log)
  }
  {
    let data = lutData(2, 96)
    c.send({ type: 'asset', id: hash(data), kind: 'lut', dims: 2, size: 96, bytes: data.length, chunks: 3 })
    c.sendBin(codec.encodeChunk(0, data.subarray(0, codec.CHUNK_SIZE)))
    c.sendBin(codec.encodeChunk(2, data.subarray(codec.CHUNK_SIZE, codec.CHUNK_SIZE * 2)))
    let m = await c.next()
    eq('an out of order chunk is reported', 'asset', m.kind)
    check('the chunk error names the expected index', /expected 1, got 2/.test(m.log), m.log)
  }
  {
    let data = lutData(2, 32) // 4096 bytes, but announced as a size 96 lut
    c.send({ type: 'asset', id: hash(data), kind: 'lut', dims: 2, size: 96, bytes: data.length, chunks: 1 })
    c.sendBin(codec.encodeChunk(0, data))
    let m = await c.next()
    check('a lut whose byte count contradicts dims/size is rejected', m.kind === 'asset' && /needs 36864 bytes/.test(m.log), m.log)
  }
  {
    let data = Buffer.from('not really a png')
    c.send({ type: 'asset', id: hash(data), kind: 'movie', bytes: data.length, chunks: 1 })
    eq('an unknown asset kind is rejected', 'asset', (await c.next()).kind)
  }

  console.log('\nprograms')
  let good, texProg
  {
    good = progMsg(['u_vs0', 'u_vs1'])
    c.send(good)
    eq('a well formed program compiles', { type: 'progok', id: good.id }, await c.next())

    c.send(good)
    eq('re-sending a cached program is acked without recompiling', 'progok', (await c.next()).type)
  }
  {
    // A fresh source, so this exercises the check rather than the program cache
    let p = progMsg(['u_vs0', 'u_vs1', 'u_vs2'])
    p.uniforms = ['u_vs0'] // source declares three, the message claims one
    c.send(p)
    let m = await c.next()
    check('a uniform list that disagrees with the source is a compile error',
      m.kind === 'compile' && /does not match/.test(m.log), JSON.stringify(m))
  }
  {
    // Same source, different uniform list: the list is a pure function of the source, so this
    // means the host disagrees with itself
    let p = Object.assign({}, good, { uniforms: ['u_vs0'] })
    c.send(p)
    let m = await c.next()
    check('a cached program re-sent with a different uniform list is rejected',
      m.kind === 'compile' && /already sent with uniforms/.test(m.log), JSON.stringify(m))
    c.send(good)
    eq('and the original program is still usable', 'progok', (await c.next()).type)
  }
  {
    let p = progMsg(['u_vs0'])
    p.id = 'aaaaaaaaaaaaaaaa'
    c.send(p)
    let m = await c.next()
    check('a program id that is not the hash of its source is rejected',
      m.kind === 'compile' && /does not match the hash/.test(m.log), JSON.stringify(m))
  }
  {
    let frag = '#version 300 es\nvoid main() {}'
    c.send({ type: 'prog', id: hash(Buffer.from(frag, 'utf8')), frag: frag, uniforms: [], textures: [] })
    let m = await c.next()
    check('a shader missing fragColor/fragCoord is a compile error', m.kind === 'compile', JSON.stringify(m))
  }
  {
    // Two different luts of the same size generate byte identical GLSL — the lut contents are not
    // in the source, only its size. So textures bind to the layer, not to the program
    // (PROTOCOL.md §7.2), and a program that samples a texture compiles without naming one
    let p = progMsg([], ['sampler2D'])
    c.send(p)
    eq('a program that samples a texture compiles without naming an asset', 'progok', (await c.next()).type)
    texProg = p
  }

  console.log('\nlayers and frames')
  {
    c.send({ type: 'layer', id: 0, prog: texProg.id, textures: [{ unit: 0, sampler: 'sampler2D', asset: 'cafecafecafecafe' }] })
    let m = await c.next()
    check('a layer binding an uncached asset is an asset error',
      m.kind === 'asset' && /not in the cache/.test(m.log), JSON.stringify(m))

    c.send({ type: 'layer', id: 0, prog: texProg.id, textures: [{ unit: 0, sampler: 'sampler2D', asset: lut2d }] })
    c.send({ type: 'have', ids: [] })
    eq('a layer binding a cached asset is accepted', 'have', (await c.next()).type)
    eq('and the layer records its texture', lut2d, main.display.layer.textures[0].asset)

    // The same program with a different lut bound: this is the case that content addressing on
    // the source alone cannot express, and is why textures live on the layer
    c.send({ type: 'layer', id: 0, prog: texProg.id, textures: [{ unit: 0, sampler: 'sampler2D', asset: lut3d }] })
    c.send({ type: 'have', ids: [] })
    await c.next()
    eq('the same program can be rebound with a different texture', lut3d, main.display.layer.textures[0].asset)

    c.send({ type: 'layer', id: 0, prog: texProg.id, textures: [] })
    let m2 = await c.next()
    check('a layer whose texture count contradicts the shader is a protocol error',
      m2.kind === 'protocol' && /declares 1 texture/.test(m2.log), JSON.stringify(m2))
    await c.next() // the close
    c = await hello(7591, { takeover: true })

    c.send(good)
    await c.next()
    c.send({ type: 'layer', id: 0, prog: good.id })
    let before = main.display.stats.rendered
    for (let i = 1; i <= 5; i++) {
      c.sendBin(codec.encodeFrame({ seq: i, dim: 1, beat: i / 4, hostTime: i / 60, layers: [{ id: 0, uniforms: [[i, 0, 0, 1], [0, 1, 0, 1]] }] }))
      await sleep(20)
    }
    check('frames with a bound layer are rendered', main.display.stats.rendered > before,
      `rendered went ${before} -> ${main.display.stats.rendered}`)
    eq('the display tracks the latest sequence number', 5, main.display.lastSeq)
  }
  {
    let dropped = main.display.stats.dropped
    // Three packets inside one 60Hz tick: the older two must be discarded, not queued
    c.sendBin(codec.encodeFrame({ seq: 10, layers: [{ id: 0, uniforms: [[1, 0, 0, 1], [0, 0, 0, 1]] }] }))
    c.sendBin(codec.encodeFrame({ seq: 11, layers: [{ id: 0, uniforms: [[2, 0, 0, 1], [0, 0, 0, 1]] }] }))
    c.sendBin(codec.encodeFrame({ seq: 12, layers: [{ id: 0, uniforms: [[3, 0, 0, 1], [0, 0, 0, 1]] }] }))
    await sleep(60)
    check('superseded frames are dropped rather than queued', main.display.stats.dropped >= dropped + 2,
      `dropped went ${dropped} -> ${main.display.stats.dropped}`)
  }
  {
    let stale = main.display.stats.stale
    c.sendBin(codec.encodeFrame({ seq: 3, layers: [{ id: 0, uniforms: [[1, 0, 0, 1], [0, 0, 0, 1]] }] }))
    await sleep(30)
    check('a frame older than the last one seen is discarded', main.display.stats.stale === stale + 1)
  }
  {
    c.sendBin(codec.encodeFrame({ seq: 20, dim: 0.25, layers: [] }))
    await sleep(30)
    eq('an empty frame is legal and still carries the dimmer', 0.25, Math.round(main.display.dim * 100) / 100)
    c.send({ type: 'dim', v: 0.75 })
    await sleep(30)
    eq('the dim message sets the dimmer when no frames are flowing', 0.75, main.display.dim)
    c.sendBin(codec.encodeFrame({ seq: 21, dim: 5, layers: [] }))
    await sleep(30)
    eq('the dimmer is clamped', 1, main.display.dim)
  }
  {
    c.send({ type: 'test', pattern: 'bars' })
    await sleep(20)
    eq('a test pattern can be selected', 'bars', main.display.testPattern)
    c.send({ type: 'test', pattern: 'off' })
    await sleep(20)
    eq('and turned off', 'off', main.display.testPattern)
  }
  {
    c.send({ type: 'somethingFromTheFuture', wat: 1 })
    c.send({ type: 'have', ids: [] })
    eq('an unknown message type is ignored rather than fatal', 'have', (await c.next()).type)
  }

  console.log('\ndisagreement between the two ends is fatal, not silent')
  {
    let c2 = await hello(7591, { takeover: true })
    await c.next() // c gets its closed:takeover
    c2.send({ type: 'layer', id: 0, prog: 'beefbeefbeefbeef' })
    let m = await c2.next()
    check('a layer naming an unsent program is a protocol error',
      m.kind === 'protocol' && /never sent/.test(m.log), JSON.stringify(m))
    eq('and closes the session', '(closed)', (await c2.next()).type)
  }
  {
    let c3 = await hello(7591, { takeover: true })
    c3.send(good)
    await c3.next()
    c3.send({ type: 'layer', id: 0, prog: good.id })
    c3.sendBin(codec.encodeFrame({ seq: 100, layers: [{ id: 0, uniforms: [[1, 1, 1, 1]] }] })) // 1, not 2
    let m = await c3.next()
    check('a frame whose uniform count contradicts the bound program is a protocol error',
      m.kind === 'protocol' && /declares 2/.test(m.log), JSON.stringify(m))
    eq('and closes the session', '(closed)', (await c3.next()).type)
  }
  {
    let c4 = await hello(7591, { takeover: true })
    c4.send({ type: 'layer', id: 1, prog: good.id })
    let m = await c4.next()
    check('a layer id other than 0 is refused in proto 1', m.kind === 'protocol', JSON.stringify(m))
    await c4.next()
  }

  console.log('\nsessions')
  {
    let a = await hello(7591, { takeover: true })
    let b = await connect(7591)
    b.send({ type: 'hello', proto: 1, takeover: false })
    eq('a second client without takeover is refused', { type: 'closed', reason: 'busy' }, await b.next())
    let stillThere = await (async () => { a.send({ type: 'have', ids: [] }); return (await a.next()).type })()
    eq('and the holder keeps its session', 'have', stillThere)

    let d2 = await hello(7591, { takeover: true })
    eq('a client with takeover displaces the holder', { type: 'closed', reason: 'takeover' }, await a.next())
    // Caches are content addressed, so they survive the session change: this is what makes a
    // browser reload cheap rather than a full re-upload
    d2.send({ type: 'have', ids: [lut2d, lut3d, good.id] })
    eq('caches survive the session change', { type: 'have', missing: [] }, await d2.next())
    d2.send({ type: 'bye' })
    eq('bye is acknowledged', { type: 'closed', reason: 'bye' }, await d2.next())
  }

  console.log('\ninjected compile failure (--fail-compile)')
  {
    let alt = start({ port: 7592, name: 'mock-b', w: 64, h: 32, drop: 0, verbose: false, failCompile: 'fragCoord' })
    await sleep(50)
    let e = await hello(7592)
    let p = progMsg(['u_vs0'])
    e.send(p)
    let m = await e.next()
    check('the injected failure comes back as a compile error with a log',
      m.kind === 'compile' && m.id === p.id && /injected failure/.test(m.log), JSON.stringify(m))
    e.send(p)
    let m2 = await e.next()
    check('a failed program stays failed rather than being recompiled', m2.kind === 'compile')
    e.close()
    alt.stop()
  }

  console.log('\ncodec')
  {
    let f = { seq: 4294967295, dim: 0.5, beat: 12.25, hostTime: 1234.5, layers: [{ id: 0, uniforms: [[1, 2, 3, 4], [5, 6, 7, 8]] }] }
    let bytes = codec.encodeFrame(f)
    eq('a one layer two uniform frame is 60 bytes', 60, bytes.length)
    let back = codec.decodeFrame(bytes)
    eq('seq survives the u32 boundary', 4294967295, back.seq)
    eq('beat and hostTime round trip', [12.25, 1234.5], [back.beat, back.hostTime])
    eq('uniform values round trip in order', [1, 2, 3, 4, 5, 6, 7, 8], Array.from(back.layers[0].values))
    eq('an empty frame is the 24 byte header alone', 24, codec.encodeFrame({ seq: 1, layers: [] }).length)
    let truncated = bytes.subarray(0, bytes.length - 4)
    let threw = false
    try { codec.decodeFrame(truncated) } catch (e) { threw = true }
    check('a truncated frame is rejected rather than read past the end', threw)
    let trailing = new Uint8Array(bytes.length + 1)
    trailing.set(bytes)
    threw = false
    try { codec.decodeFrame(trailing) } catch (e) { threw = true }
    check('trailing bytes are rejected', threw)
  }

  main.stop()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

run().catch(e => { console.error('\n🔴 selftest crashed:', e && e.stack || e); process.exit(1) })
