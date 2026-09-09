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

  // Why the socket closed. This is the difference between "the display rejected what we sent" and
  // "the display went away", and it is already on the wire -- but onclose used to ignore it, so a
  // compile-driven protocol error, a message the display judged too big and the daemon dying all
  // read as the same bare "disconnected", with the reason nowhere in the console.
  // 1006 is the important one: the browser synthesises it when no close frame ever arrived, ie the
  // process died or the link dropped. Every other code here is one the display chose.
  let closeCodes = {
    1000: 'closed normally',
    1001: 'display going away',
    1002: 'protocol error - the two ends disagree about state',
    1003: 'unacceptable data',
    1005: 'no code given',
    1006: 'no close frame - the display died or the link dropped',
    1009: 'message too big for the display',
    1011: 'display internal error',
  }
  let closeDetail = (e) => {
    let code = (e && e.code) || 0
    let reason = (e && e.reason) ? `, "${e.reason}"` : ''
    return `${code} ${closeCodes[code] || 'unknown code'}${reason}`
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
      wantBlank: false, // an `unlayer` that still has to reach the display -- see flushBlank
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
      progSize: null, // {id, bytes, uniforms} of the last program shipped, for `hub75 status`
      lastSizeReport: 0, // rate limit on the size line below
      skipped: 0, // frames dropped by the backpressure rule below -- see sendFrame
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

    // The one number that answers "is this px chain too big to ship?", which nothing used to say
    // until the chain was already over the limit. Measured on the *encoded* message, because that
    // is what MAX_MESSAGE caps: JSON escaping every newline in the shader costs a byte apiece, so
    // d.source.length reads low. Recorded unconditionally for `hub75 status`; only spoken once a
    // second, since a chain that regenerates its source every event would otherwise flood the
    // console at frame rate (draw/visualsynth.js warns about that case in its own words).
    let reportProgSize = (progId, msg) => {
      let bytes = JSON.stringify(msg).length
      s.progSize = {id: progId, bytes: bytes, uniforms: msg.uniforms.length}
      let pct = Math.round(bytes * 100 / MAX_MESSAGE)
      let big = bytes * 5 > MAX_MESSAGE * 4 // within a fifth of the cap: worth saying before it trips
      let now = Date.now()
      if (!big && now - s.lastSizeReport < 1000) { return }
      s.lastSizeReport = now
      say(`${big ? '🟠' : '⚪'} %s: program ${progId.slice(0, 8)} is ${bytes} bytes` +
        ` (${pct}% of the ${MAX_MESSAGE} byte limit), ${msg.uniforms.length} uniforms`)
    }

    let sendBinary = (bytes) => {
      if (!isOpen()) { return false }
      s.ws.send(bytes)
      return true
    }

    // "show nothing" is a state the display has to be told about, and it has to be told about it
    // even when this end has forgotten what it bound. s.bound is host *belief*: onclose clears it
    // (the display may have restarted) while a display that did not restart is still showing the
    // layer, and sendJson drops a message silently when the socket is down. Conditioning the
    // `unlayer` on either of those left a wall lit with a picture whose player was long gone, and
    // nothing could ever reach it again - `layers[name]` was deleted, so hub75.js's orphan poll was
    // finished, and reconcile() returns early on a null `desired`, so it never ran either. So the
    // intent is held until it has actually gone out over an open socket, and retried from `welcome`
    // and from pump(). It is idempotent: a display with nothing bound ignores it (PROTOCOL.md 7.2).
    let flushBlank = () => {
      if (!s.wantBlank) { return }
      if (!sendJson({type: 'unlayer', id: 0})) { return } // socket down; welcome and pump retry
      s.wantBlank = false
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
      ws.onclose = (e) => {
        if (s.ws !== ws) { return }
        s.ws = null
        s.bound = null // the display may have been restarted; re-bind from scratch on reconnect
        s.sending = null
        s.uploads = []
        s.afterUploads = null
        s.pendingBound = null
        s.sentIds.clear() // it may come back restarted; the next `have` establishes the truth
        if (s.pendingHave) { s.pendingHave.resolve([]); s.pendingHave = null }
        if (s.state === 'open') { say(`🟠 %s: disconnected (${closeDetail(e)})`) }
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
          flushBlank() // before reconcile: establish what should NOT be showing, then bind what should
          reconcile()
          break
        }
        case 'have': {
          if (s.pendingHave) { let p = s.pendingHave; s.pendingHave = null; p.resolve(msg.missing || []) }
          break
        }
        case 'assetok': { s.sentIds.add(msg.id); break }
        case 'progok': {
          s.sentIds.add(msg.id)
          // Only now is it safe to SEND the layer, let alone to say we are showing it. The display
          // compiles on receipt and blocks its whole loop doing it - seconds for a big chain - so a
          // layer sent alongside the program rebinds the display in the middle of a window in which
          // this end is still streaming the *previous* program's uniforms. The moment the two counts
          // differ that is a session closing protocol error (§12.1), and before it closes the display
          // has already drawn the new program with the old program's values - the white or
          // wrong-coloured frame the wall then holds until the reconnect rebinds. Holding the layer
          // back keeps the old program bound and its uniforms valid for the whole compile, so the
          // wall stays live on the old visual right up to the swap. There is no layer ack in v1, but
          // ordered delivery means a layer that follows an acknowledged program is bound by the time
          // the next frame lands.
          if (s.pendingBound !== null && s.pendingBound.progId === msg.id) {
            s.pendingBound.needsAck = false
            pumpUploads() // sends the layer now, or on the frame the asset queue finally drains
          }
          break
        }
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
        // The display refuses to bind a layer naming a program that failed to compile, and this
        // message is the only way it says so - protocol v1 has no layer acknowledgement, so the
        // host binds optimistically the moment it sends `layer`. Keeping that bind means the very
        // next frame goes out with a layer the display does not have, which is a session-closing
        // protocol error (§12.1) - so a shader the display merely *rejected* became a
        // disconnect, closing the socket on top of the compile log that explains it. Drop the bind
        // instead: frames then carry no layer, which is legal, and the log below stays readable.
        if (s.bound !== null && s.bound.progId === msg.id) { s.bound = null }
        if (s.pendingBound !== null && s.pendingBound.progId === msg.id) { s.pendingBound = null }
        if (s.afterUploads !== null && s.afterUploads.prog === msg.id) { s.afterUploads = null }
        // Mirrors draw/visualsynth.js setting programs[src] = null: the source cannot start
        // compiling later, so resending it every event would be pure noise
        // A driver's own log is many lines of GLSL diagnostics and wants its own; ours is one short
        // sentence and reads better inline than as a two line block in the middle of a set.
        let log = msg.log || 'no log'
        let inline = log.indexOf('\n') === -1 && log.length < 120
        consoleOut(`🔴 hub75 ${name}: shader ${msg.kind} error${where}:${inline ? ' ' : '\n'}${log}`)
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
                let prog = {type: 'prog', id: progId, frag: d.source, uniforms: d.uniformNames}
                reportProgSize(progId, prog)
                if (!sendJson(prog)) { return }
              }
              s.afterUploads = {
                type: 'layer', id: 0, prog: progId,
                textures: d.textures.map((t, i) => ({unit: i, sampler: t.sampler, asset: assetIds[i]})),
              }
              // needsAck only when we are actually sending the program: one the display already
              // holds was compiled on an earlier visit and will send no second progok, so waiting
              // for one would leave the layer unbound forever.
              s.pendingBound = {key: d.key, progId: progId, uniformCount: d.uniformNames.length,
                                needsAck: need.has(progId)}
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
      if (s.sending === null && s.uploads.length === 0 && s.afterUploads !== null &&
          s.pendingBound !== null && !s.pendingBound.needsAck) {
        // Two conditions, and both matter: every asset the layer names is cached - ordered delivery
        // is what makes that safe (§7.2) - and the program it names is compiled. `needsAck` is true
        // only while we are actually shipping the program; one the display already holds sends no
        // second `progok`, so waiting for one would leave the layer unsent forever. See `progok`.
        if (sendJson(s.afterUploads)) {
          s.bound = s.pendingBound
          s.pendingBound = null
        }
        s.afterUploads = null
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
      s.wantBlank = false // superseded: a layer is wanted again, and a late unlayer would blank it
      if (changed) { reconcile() }
    }

    s.clearDesired = () => {
      s.desired = null
      s.generation++
      s.uploads = []
      s.sending = null
      s.afterUploads = null
      s.pendingBound = null
      s.bound = null
      s.wantBlank = true
      flushBlank()
    }

    // Returns the layer the display is actually showing, so the frame packet's uniform count can
    // never disagree with the bound program (§12.1 makes that a session-closing protocol error)
    s.boundLayer = () => s.bound

    s.sendFrame = (uniformValues, dim, beat, hostTime) => {
      if (!isOpen()) { return false }
      // §12.1: a frame that had to be queued is stale by the time it lands. Skipping is the correct
      // behaviour, not a degradation -- but it was also invisible, and a stalled link makes it the
      // dominant source of missing frames. Counted so `hub75 status` can say so; the display sees
      // the same thing as a gap in `seq`, which it reports as pacing.seqGaps.
      if (s.ws.bufferedAmount > MAX_BUFFERED) { s.skipped++; return false }
      s.dim = dim
      let layers = uniformValues === null ? [] : [{id: 0, uniforms: uniformValues}]
      sendBinary(codec.encodeFrame({
        seq: s.seq++, dim: dim, beat: beat, hostTime: hostTime, layers: layers,
      }))
      s.frames++
      return true
    }

    s.pump = () => { flushBlank(); pumpUploads() } // flushBlank first: a blank owed from a closed socket

    // The text message entry point, the same one ws.onmessage feeds. Public so the inline tests
    // below can drive the state machine without standing up a socket.
    s.handleText = onText

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

  // A close code is the only thing that separates "the display rejected what we sent" from "the
  // display died", so it has to reach the console intact
  assert('1006 no close frame - the display died or the link dropped', closeDetail({code: 1006, reason: ''}))
  assert('1002 protocol error - the two ends disagree about state, "protocol"',
    closeDetail({code: 1002, reason: 'protocol'}))
  assert('1009 message too big for the display', closeDetail({code: 1009}))
  assert('4000 unknown code', closeDetail({code: 4000})) // still says the number rather than nothing
  assert('0 unknown code', closeDetail(undefined)) // onclose with no event at all

  // A fake socket, so none of the tests below open anything
  let socket = (state) => { let o = {readyState: state, bufferedAmount: 0, sent: [],
    send: (t) => o.sent.push(typeof t === 'string' ? JSON.parse(t).type : 'binary')}; return o }

  // §8: the display refuses to bind a layer whose program failed to compile, and says so with an
  // `error` and nothing else. The host must let go of its optimistic bind, or the next frame names
  // a layer the display does not have -- a session closing protocol error, which would take the
  // compile log down with it and leave a bare connect/disconnect loop as the only symptom.
  // Named so the two error lines this deliberately provokes cannot be mistaken, in an otherwise
  // clean ?test run, for a real display having a real problem. No socket is opened.
  let sess = makeSession('not-a-real-display')
  sess.bound = {key: 'k', progId: 'aaaa1111', uniformCount: 3}
  sess.afterUploads = {type: 'layer', id: 0, prog: 'aaaa1111', textures: []}
  sess.pendingBound = {key: 'k', progId: 'aaaa1111', uniformCount: 3}
  sess.handleText({type: 'error', kind: 'compile', id: 'aaaa1111', log: 'test: expected compile failure'})
  assert(null, sess.bound)
  assert(null, sess.afterUploads)
  assert(null, sess.pendingBound)
  assert(true, sess.failedProgs.has('aaaa1111')) // still permanent for that source

  // §7.1: the layer is not even SENT until the display has acknowledged the program, let alone
  // claimed as bound. The display compiles on receipt and blocks its loop doing it - seconds for a
  // big chain - so a layer sent alongside the program rebinds the display in the middle of a window
  // in which this end is still streaming the previous program's uniforms. The moment the counts
  // differ that closes the session, and the frame the display draws on the swap comes out of the
  // old program's values: the white frame the wall then holds until the reconnect.
  let sess2 = makeSession('not-a-real-display')
  sess2.ws = socket(1)
  sess2.pendingBound = {key: 'k', progId: 'dddd4444', uniformCount: 2, needsAck: true}
  sess2.afterUploads = {type: 'layer', id: 0, prog: 'dddd4444', textures: []}
  sess2.pump()
  assert([], sess2.ws.sent) // nothing goes out while the display is still compiling
  assert(null, sess2.bound)
  sess2.handleText({type: 'progok', id: 'dddd4444'})
  assert(['layer'], sess2.ws.sent) // only now, and the bind lands with it
  assert({key: 'k', progId: 'dddd4444', uniformCount: 2, needsAck: false}, sess2.bound)
  assert(null, sess2.pendingBound)
  assert(null, sess2.afterUploads)
  assert(true, sess2.sentIds.has('dddd4444'))

  // A program the display already holds sends no second `progok`, so waiting for one would leave
  // the layer unsent forever: needsAck false goes out on the next pump.
  let sess2b = makeSession('not-a-real-display')
  sess2b.ws = socket(1)
  sess2b.pendingBound = {key: 'k', progId: 'dddd4444', uniformCount: 2, needsAck: false}
  sess2b.afterUploads = {type: 'layer', id: 0, prog: 'dddd4444', textures: []}
  sess2b.pump()
  assert(['layer'], sess2b.ws.sent)
  assert({key: 'k', progId: 'dddd4444', uniformCount: 2, needsAck: false}, sess2b.bound)

  // An ack for something else leaves the pending bind pending, and sends nothing
  sess2.bound = null
  sess2.ws = socket(1)
  sess2.pendingBound = {key: 'k', progId: 'eeee5555', uniformCount: 2, needsAck: true}
  sess2.afterUploads = {type: 'layer', id: 0, prog: 'eeee5555', textures: []}
  sess2.handleText({type: 'progok', id: 'ffff6666'})
  assert(null, sess2.bound)
  assert([], sess2.ws.sent)

  // ...but a failure for some other program must not unbind what is happily showing
  sess.bound = {key: 'k2', progId: 'bbbb2222', uniformCount: 1}
  sess.handleText({type: 'error', kind: 'link', id: 'cccc3333', log: 'test: expected link failure'})
  assert({key: 'k2', progId: 'bbbb2222', uniformCount: 1}, sess.bound)

  // The wall must be told to blank even when this end has forgotten what it bound. Every one of
  // these left a lit wall showing a picture whose player was gone, unreachably: hub75.js deletes
  // layers[name] on release so its orphan poll never fires again, and reconcile() returns early on a
  // null `desired`, so nothing retried. A fake socket, so nothing is opened.
  // s.bound null with the display still showing the layer - which is every session that ever
  // dropped and came back, since onclose clears it in case the display restarted
  let sess3 = makeSession('not-a-real-display')
  sess3.ws = socket(1)
  sess3.bound = null
  sess3.clearDesired()
  assert(['unlayer'], sess3.ws.sent)
  assert(false, sess3.wantBlank) // delivered, so not owed any more

  // Released while the socket was down: sendJson drops it silently, so the intent has to survive
  // until the session comes back
  let sess4 = makeSession('not-a-real-display')
  sess4.ws = socket(3) // CLOSED
  sess4.bound = {key: 'k', progId: 'aaaa1111', uniformCount: 1}
  sess4.clearDesired()
  assert([], sess4.ws.sent)
  assert(true, sess4.wantBlank)
  sess4.ws = socket(1) // reconnected
  sess4.handleText({type: 'welcome', proto: PROTO, display: {w: 64, h: 64}})
  assert(['unlayer'], sess4.ws.sent) // and `welcome` is where it goes out, before any rebind
  assert(false, sess4.wantBlank)

  // pump() is the other retry, so a session that comes back between welcome and the next frame
  // still blanks
  let sess5 = makeSession('not-a-real-display')
  sess5.ws = socket(3)
  sess5.clearDesired()
  sess5.ws = socket(1)
  sess5.pump()
  assert(['unlayer'], sess5.ws.sent)
  sess5.pump()
  assert(['unlayer'], sess5.ws.sent) // once only: not resent every frame for the rest of the run

  // ...and an owed blank must never blank a layer that has since been wanted again. This is the one
  // way the retry could make things worse: an edit that rebinds while the unlayer is still owed.
  let sess6 = makeSession('not-a-real-display')
  sess6.ws = socket(3)
  sess6.clearDesired()
  assert(true, sess6.wantBlank)
  sess6.ws = socket(1)
  sess6.setDesired({key: 'k2', source: 'x', uniformNames: [], textures: [], assetList: []})
  assert(false, sess6.wantBlank)
  sess6.pump()
  assert([], sess6.ws.sent.filter(t => t === 'unlayer'))

  console.log('Hub75 session tests complete')
  }

  return {
    makeSession: makeSession,
    resolveEndpoint: resolveEndpoint,
    closeDetail: closeDetail,
    PROTO: PROTO,
    DEFAULT_PORT: DEFAULT_PORT,
    MAX_MESSAGE: MAX_MESSAGE,
    MAX_BUFFERED: MAX_BUFFERED,
    CHUNKS_PER_FRAME: CHUNKS_PER_FRAME,
  }
})
