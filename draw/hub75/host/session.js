'use strict'
define(function (require) {
  let consoleOut = require('console')
  let codec = require('draw/hub75/codec')
  let {sha256id, utf8} = require('draw/hub75/host/sha256')
  let assets = require('draw/hub75/host/assets')

  // One display: discovery, the WebSocket session, and the reconcile loop that gets the desired
  // layer onto it. See draw/hub75/PROTOCOL.md — section numbers below refer to it.
  //
  // Everything here is driven by two things: setDesired() from a visualsynth event, and pump()
  // once per animation frame. There is no timer of its own except the reconnect backoff.

  let PROTO = 1
  let DEFAULT_PORT = 7575
  let MAX_MESSAGE = 60000 // §3: every message must fit one unfragmented frame, ≤60KB
  let MAX_BUFFERED = 128 * 1024 // §12.1 backpressure
  let CHUNKS_PER_FRAME = 4 // 64KB/frame: fast enough for any lut, slow enough to interleave
  let BACKOFF_MIN = 250
  let BACKOFF_MAX = 5000

  // §4: 'hub75-01' is a bare mDNS name; anything with a dot or a colon is already a host, so the
  // three forms the user might reasonably type all resolve without a mode flag
  let resolveEndpoint = (name) => {
    let s = String(name).trim()
    let port = DEFAULT_PORT
    let colon = s.lastIndexOf(':')
    if (colon > 0 && /^\d+$/.test(s.slice(colon + 1))) {
      port = parseInt(s.slice(colon + 1), 10)
      s = s.slice(0, colon)
    }
    if (s.indexOf('.') === -1 && s !== 'localhost') { s = s + '.local' }
    return {host: s, port: port}
  }

  let makeSession = (name, onError) => {
    let ep = resolveEndpoint(name)
    let s = {
      name: name,
      endpoint: ep,
      httpUrl: 'http://' + ep.host + ':' + ep.port,
      wsUrl: 'ws://' + ep.host + ':' + ep.port + '/session',
      ws: null,
      state: 'idle', // idle | connecting | open | backoff | stopped
      info: null, // from /info and welcome
      stat: null, // latest telemetry (§11)
      sentIds: new Set(), // ids the display has confirmed caching, for `hub75 status`
      pendingBound: null, // the layer the current upload run is working towards
      failedProgs: new Set(), // §8: a compile failure is permanent for that id
      desired: null, // what should be on the display
      bound: null, // what we have told the display to show
      seq: 0,
      dim: 1,
      manualDim: 1,
      uploads: [], // queued assets, sent a few chunks per frame so they interleave with the stream
      sending: null, // {id, bytes, next, chunks}
      afterUploads: null, // the layer message to send once the queue drains
      pendingHave: null,
      backoff: BACKOFF_MIN,
      retryTimer: null,
      generation: 0,
      frames: 0, // frame packets actually sent, for `hub75 status`
      lastProblem: null,
    }

    let say = (str) => consoleOut(str.replace('%s', 'hub75 ' + name))
    let problem = (str) => {
      if (s.lastProblem === str) { return } // a failing display retries forever; do not flood
      s.lastProblem = str
      consoleOut(str)
      if (onError) { onError(s, str) }
    }

    // ---- sending ----------------------------------------------------------------------------

    let isOpen = () => s.ws !== null && s.ws.readyState === 1

    let sendJson = (msg) => {
      if (!isOpen()) { return false }
      let text = JSON.stringify(msg)
      // §3 caps a message at 60KB so neither end ever needs reassembly. A px chain that generates
      // a shader that big is pathological, but silently sending it would fail as an opaque socket
      // close on the display rather than as something anyone could act on.
      if (text.length > MAX_MESSAGE) {
        problem(`🔴 hub75 ${name}: ${msg.type} message is ${text.length} bytes, over the ${MAX_MESSAGE} byte limit`)
        return false
      }
      s.ws.send(text)
      return true
    }

    let sendBinary = (bytes) => {
      if (!isOpen()) { return false }
      s.ws.send(bytes)
      return true
    }

    // ---- connection -------------------------------------------------------------------------

    let scheduleRetry = () => {
      if (s.state === 'stopped' || s.retryTimer !== null) { return }
      s.state = 'backoff'
      let wait = s.backoff
      s.backoff = Math.min(BACKOFF_MAX, s.backoff * 2)
      s.retryTimer = setTimeout(() => { s.retryTimer = null; connect() }, wait)
    }

    let connect = () => {
      if (s.state === 'stopped' || s.state === 'connecting' || isOpen()) { return }
      s.state = 'connecting'
      // §4: probe /info first. It separates "nothing is listening" from "something is listening but
      // speaks a different protocol", and it is where a missing CORS header shows up — without
      // which the browser reports an opaque network failure and discovery looks broken for no
      // visible reason.
      fetch(s.httpUrl + '/info', {cache: 'no-store'})
        .then(r => r.ok ? r.json() : Promise.reject(new Error('/info returned ' + r.status)))
        .then(info => {
          if (info.proto !== PROTO) {
            throw new Error(`display speaks proto ${info.proto}, limut speaks ${PROTO}`)
          }
          s.info = info
          openSocket()
        })
        .catch(e => {
          problem(`🔴 hub75 ${name}: cannot reach ${s.httpUrl}/info (${e.message}). ` +
            `Check the display is running, and that it sends Access-Control-Allow-Origin.`)
          scheduleRetry()
        })
    }

    let openSocket = () => {
      let ws
      try { ws = new WebSocket(s.wsUrl) } catch (e) {
        problem(`🔴 hub75 ${name}: cannot open ${s.wsUrl}: ${e}`)
        return scheduleRetry()
      }
      ws.binaryType = 'arraybuffer'
      s.ws = ws
      ws.onopen = () => {
        // §5.1 takeover: a browser reload must never lock itself out of its own display
        sendJson({type: 'hello', proto: PROTO, client: 'limut', name: document.title || 'limut', takeover: true})
      }
      ws.onmessage = (e) => {
        try {
          if (typeof e.data === 'string') { onText(JSON.parse(e.data)) } else { onBinary(e.data) }
        } catch (err) {
          consoleOut(`🔴 hub75 ${name}: bad message from display: ${err}`)
        }
      }
      ws.onclose = () => {
        if (s.ws !== ws) { return }
        s.ws = null
        s.bound = null // the display may have been restarted; re-bind from scratch on reconnect
        s.sending = null
        s.uploads = []
        s.afterUploads = null
        s.pendingBound = null
        s.sentIds.clear() // it may come back restarted; the next `have` establishes the truth
        if (s.pendingHave) { s.pendingHave.resolve([]); s.pendingHave = null }
        if (s.state === 'open') { say('🟠 %s: disconnected') }
        if (s.state !== 'stopped') { scheduleRetry() }
      }
      ws.onerror = () => {} // onclose always follows, and does the reporting
    }

    let onText = (msg) => {
      if (typeof msg !== 'object' || msg === null) { return }
      switch (msg.type) {
        case 'welcome': {
          s.state = 'open'
          s.backoff = BACKOFF_MIN
          s.lastProblem = null
          s.info = {proto: msg.proto, name: msg.name, display: msg.display, gl: msg.gl}
          let d = msg.display || {}
          say(`🟢 %s: connected, ${d.w}x${d.h}, ${(msg.gl || {}).renderer || 'unknown gpu'}`)
          if (s.manualDim !== 1) { sendJson({type: 'dim', v: s.manualDim}) }
          reconcile()
          break
        }
        case 'have': {
          if (s.pendingHave) { let p = s.pendingHave; s.pendingHave = null; p.resolve(msg.missing || []) }
          break
        }
        case 'assetok': { s.sentIds.add(msg.id); break }
        case 'progok': { s.sentIds.add(msg.id); break }
        case 'stat': { s.stat = msg; break }
        case 'error': { onError_(msg); break }
        case 'closed': { onClosed(msg); break }
        default: break // §5.2: unknown types are ignored, for forward compatibility
      }
    }

    // §8. compile and link are permanent for that id; asset and render are transient.
    let onError_ = (msg) => {
      let where = msg.id ? ' ' + msg.id.slice(0, 8) : ''
      if (msg.kind === 'compile' || msg.kind === 'link') {
        s.failedProgs.add(msg.id)
        // Mirrors draw/visualsynth.js setting programs[src] = null: the source cannot start
        // compiling later, so resending it every event would be pure noise
        consoleOut(`🔴 hub75 ${name}: shader ${msg.kind} error${where}:\n${msg.log}`)
      } else if (msg.kind === 'asset') {
        s.sentIds.delete(msg.id)
        consoleOut(`🟠 hub75 ${name}: asset error${where}: ${msg.log}`)
        reconcile() // transient: the upload may simply be worth retrying
      } else {
        consoleOut(`🔴 hub75 ${name}: ${msg.kind} error${where}: ${msg.log}`)
      }
    }

    let onClosed = (msg) => {
      if (msg.reason === 'proto' || msg.reason === 'busy') {
        // Retrying either of these as fast as anything else would just spin: proto needs one end
        // upgrading, busy needs the other client to leave
        s.backoff = BACKOFF_MAX
        problem(`🔴 hub75 ${name}: display refused the session (${msg.reason})`)
      } else if (msg.reason === 'takeover') {
        s.backoff = BACKOFF_MAX
        problem(`🟠 hub75 ${name}: another client took the display`)
      }
    }

    let onBinary = () => {} // the display sends no binary packets in version 1

    // ---- reconcile --------------------------------------------------------------------------

    // Ask which of these ids the display is missing (§5.3). One outstanding request at a time; a
    // superseded reconcile is dropped by its generation check rather than by its reply.
    let askHave = (ids) => new Promise(resolve => {
      if (s.pendingHave) { s.pendingHave.resolve([]) }
      s.pendingHave = {resolve: resolve}
      if (!sendJson({type: 'have', ids: ids})) { s.pendingHave = null; resolve(ids) }
    })

    // Get s.desired onto the display. Re-entrant: every await is followed by a generation check, so
    // a px edit part way through simply abandons the older run.
    let reconcile = () => {
      let gen = ++s.generation
      let d = s.desired
      if (!d || !isOpen()) { return Promise.resolve() }
      if (s.bound && s.bound.key === d.key) { return Promise.resolve() } // already showing it
      let stale = () => gen !== s.generation || s.desired !== d || !isOpen()

      return Promise.all([sha256id(utf8(d.source))].concat(d.assetList.map(a => sha256id(a.bytes))))
        .then(ids => {
          if (stale()) { return }
          let progId = ids[0]
          let assetIds = ids.slice(1)
          if (s.failedProgs.has(progId)) { return } // §8: never resend a program that failed to compile
          // Always ask, for every id, rather than trusting what we think the display has. The
          // display's caches survive a session change (§5.1) but not a restart, and a host that
          // assumed otherwise would bind a layer naming a program the display never received -
          // which is a protocol error that closes the session, so it would reconnect into the same
          // wrong assumption forever. The round trip is two 16 character ids, once per layer change.
          return askHave([progId].concat(assetIds))
            .then(missing => {
              if (stale()) { return }
              let need = new Set(missing)
              // Queue every missing asset, then send the program, then bind. Delivery is ordered on
              // one socket, so the layer cannot arrive before what it references.
              s.uploads = []
              d.assetList.forEach((a, i) => {
                if (!need.has(assetIds[i])) { return }
                s.uploads.push({id: assetIds[i], announce: assets.announce(assetIds[i], a), bytes: a.bytes})
              })
              if (need.has(progId)) {
                if (!sendJson({type: 'prog', id: progId, frag: d.source, uniforms: d.uniformNames})) { return }
              }
              s.afterUploads = {
                type: 'layer', id: 0, prog: progId,
                textures: d.textures.map((t, i) => ({unit: i, sampler: t.sampler, asset: assetIds[i]})),
              }
              s.pendingBound = {key: d.key, progId: progId, uniformCount: d.uniformNames.length}
              pumpUploads() // send what we can now; the rest goes out over the next frames
            })
        })
    }

    // Called once per animation frame: move the asset queue along a few chunks at a time, so a big
    // asset interleaves with the uniform stream (§6.2) instead of stalling it behind itself
    let pumpUploads = () => {
      if (!isOpen()) { return }
      let budget = CHUNKS_PER_FRAME
      while (budget > 0) {
        if (s.sending === null) {
          if (s.uploads.length === 0) { break }
          s.sending = s.uploads.shift()
          s.sending.next = 0
          s.sending.chunks = assets.chunkCount(s.sending.bytes.length)
          if (!sendJson(s.sending.announce)) { s.sending = null; return }
        }
        let c = s.sending
        if (!sendBinary(codec.encodeChunk(c.next, assets.chunkAt(c.bytes, c.next)))) { return }
        c.next++
        budget--
        if (c.next >= c.chunks) { s.sending = null } // `assetok` is what records it as cached
      }
      if (s.sending === null && s.uploads.length === 0 && s.afterUploads !== null) {
        if (sendJson(s.afterUploads)) { s.bound = s.pendingBound }
        s.afterUploads = null
        s.pendingBound = null
      }
    }

    // ---- public ------------------------------------------------------------------------------

    s.start = () => {
      if (s.state === 'stopped') { s.state = 'idle' }
      if (s.state === 'idle') { connect() }
    }

    // desc: {key, source, uniformNames, textures:[{sampler}], assetList:[{kind,dims,size,bytes}], live}
    s.setDesired = (desc) => {
      let changed = s.desired === null || s.desired.key !== desc.key
      s.desired = desc
      if (changed) { reconcile() }
    }

    s.clearDesired = () => {
      s.desired = null
      s.generation++
      s.uploads = []
      s.sending = null
      s.afterUploads = null
      s.pendingBound = null
      if (s.bound) { sendJson({type: 'unlayer', id: 0}); s.bound = null }
    }

    // Returns the layer the display is actually showing, so the frame packet's uniform count can
    // never disagree with the bound program (§12.1 makes that a session-closing protocol error)
    s.boundLayer = () => s.bound

    s.sendFrame = (uniformValues, dim, beat, hostTime) => {
      if (!isOpen()) { return false }
      // §12.1: a frame that had to be queued is stale by the time it lands. Skipping is the correct
      // behaviour, not a degradation.
      if (s.ws.bufferedAmount > MAX_BUFFERED) { return false }
      s.dim = dim
      let layers = uniformValues === null ? [] : [{id: 0, uniforms: uniformValues}]
      sendBinary(codec.encodeFrame({
        seq: s.seq++, dim: dim, beat: beat, hostTime: hostTime, layers: layers,
      }))
      s.frames++
      return true
    }

    s.pump = () => pumpUploads()

    s.setDim = (v) => {
      s.manualDim = Math.max(0, Math.min(1, v))
      sendJson({type: 'dim', v: s.manualDim}) // §9: works even with no layer bound
    }

    s.setTest = (pattern) => sendJson({type: 'test', pattern: pattern})

    s.stop = () => {
      s.state = 'stopped'
      if (s.retryTimer !== null) { clearTimeout(s.retryTimer); s.retryTimer = null }
      if (isOpen()) { sendJson({type: 'bye'}) }
      if (s.ws) { s.ws.close() }
      s.ws = null
    }

    return s
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  // §4: the four forms a user might type all resolve, without a mode flag
  assert({host: 'hub75-01.local', port: 7575}, resolveEndpoint('hub75-01'))
  assert({host: 'hub75-01.local', port: 7575}, resolveEndpoint('hub75-01.local'))
  assert({host: '10.0.0.7', port: 7575}, resolveEndpoint('10.0.0.7:7575'))
  assert({host: '10.0.0.7', port: 7575}, resolveEndpoint('10.0.0.7'))
  assert({host: 'localhost', port: 7575}, resolveEndpoint('localhost:7575'))
  assert({host: 'localhost', port: 7575}, resolveEndpoint('localhost')) // not localhost.local
  assert({host: 'hub75-01.local', port: 9000}, resolveEndpoint('hub75-01:9000'))
  assert({host: 'hub75-01.local', port: 7575}, resolveEndpoint('  hub75-01  ')) // typed with spaces
  // A trailing colon with no digits is part of the name, not a port
  assert({host: 'wall.local', port: 7575}, resolveEndpoint('wall'))

  console.log('Hub75 session tests complete')
  }

  return {
    makeSession: makeSession,
    resolveEndpoint: resolveEndpoint,
    PROTO: PROTO,
    DEFAULT_PORT: DEFAULT_PORT,
    MAX_MESSAGE: MAX_MESSAGE,
    MAX_BUFFERED: MAX_BUFFERED,
    CHUNKS_PER_FRAME: CHUNKS_PER_FRAME,
  }
})
