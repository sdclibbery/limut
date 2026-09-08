'use strict'
define(function (require) {
  let consoleOut = require('console')
  let players = require('player/players')
  let audioSystem = require('play/system')
  let {evalParamFrame} = require('player/eval-param')
  let {toVec4} = require('draw/visualsynth/shader-node')
  let {getCallTree, setCallTree, clearCallTree} = require('player/callstack')
  let {makeSession} = require('draw/hub75/host/session')
  let assets = require('draw/hub75/host/assets')

  // The limut end of the HUB75 display protocol (draw/hub75/PROTOCOL.md).
  //
  // A visualsynth px chain compiles to a completely self-contained shader, so the whole shippable
  // state of a display bound visual is a fragment source string, an ordered list of vec4 uniforms,
  // and its lookup textures. draw/visualsynth.js hands all three here instead of drawing locally,
  // and this module sends the uniforms once per animation frame.
  //
  // Structurally this is draw/dmx-system.js: an output device with its own state, driven once per
  // rAF tick from main.js, decoupled from the GL frame loop, last write wins.

  let sessions = {} // display name -> session
  let layers = {} // display name -> {playerId, key, liveByKey}
  let byPlayer = {} // player id -> display name

  let warned = {}
  let warnOnce = (msg) => {
    if (warned[msg]) { return }
    warned[msg] = true
    consoleOut(msg)
  }

  // A stable identity for a texture object, so a layer key can tell two chains apart that generate
  // byte-identical GLSL. This is the trap PROTOCOL.md 7.2 exists for: tex1d{{x}->x} and
  // tex1d{{x}->1-x} produce the same source (only the lut's *size* is baked in, never its contents)
  // and so the same program id, while needing entirely different texture data.
  let texIds = new WeakMap()
  let nextTexId = 1
  let texId = (t) => {
    if (t === null || typeof t !== 'object') { return 'x' }
    let id = texIds.get(t)
    if (id === undefined) { id = nextTexId++; texIds.set(t, id) }
    return id
  }

  let layerKey = (built) => built.source + ' ' + built.textures.map(t => texId(t.texture)).join(',')

  let getSession = (name) => {
    let s = sessions[name]
    if (s === undefined) {
      s = makeSession(name)
      sessions[name] = s
      s.start()
    }
    return s
  }

  // Called from draw/visualsynth.js for every event of a player with a display param
  let setLayer = (name, params, built) => {
    let playerId = (params._player && params._player.id) || '?'

    // Version 1 accepts one player per display (PROTOCOL.md 7.2). Last one wins, but say so once:
    // two players silently fighting over a wall is not something to discover by watching it flicker.
    let owner = layers[name]
    if (owner && owner.playerId !== playerId) {
      warnOnce(`🟠 hub75 ${name}: ${playerId} has taken the display from ${owner.playerId} (one player per display in version 1)`)
    }

    // Connect even if the chain turns out to be unshippable: the dimmer, the test patterns and
    // `hub75 status` all work with nothing bound, and the moment the chain is fixed it binds
    let session = getSession(name)

    // Refuse anything whose textures cannot be shipped, rather than binding a layer that would
    // sample whatever was left in that texture unit
    let classified = built.textures.map(t => assets.classify(t.texture))
    let bad = classified.find(c => c.unsupported !== undefined)
    if (bad !== undefined) {
      warnOnce(`🟠 hub75 ${name}: not sending ${playerId}: ${assets.unsupportedReason[bad.unsupported]}`)
      return
    }

    let key = layerKey(built)
    let entry = layers[name]
    if (entry === undefined || entry.playerId !== playerId) {
      entry = {playerId: playerId, key: key, liveByKey: new Map()}
      layers[name] = entry
    }
    // Keyed by layer key, not just "latest": while a new chain is still uploading, the display is
    // still showing the old program, and its frame packets must carry the old program's uniform
    // count or the session closes on a protocol error (PROTOCOL.md 12.1)
    entry.liveByKey.set(key, {params: params, uniforms: built.uniforms})
    entry.key = key
    byPlayer[playerId] = name

    session.setDesired({
      key: key,
      source: built.source,
      uniformNames: built.uniforms.map(u => u.name),
      textures: built.textures,
      assetList: classified,
    })
  }

  // Called from draw/visualsynth.js when a player has no display param, so a line edited from
  // display='wall' back to a local visual gives the wall up rather than freezing on it
  let releaseFor = (playerId) => {
    let name = byPlayer[playerId]
    if (name === undefined) { return }
    delete byPlayer[playerId]
    let entry = layers[name]
    if (entry && entry.playerId === playerId) { release(name) }
  }

  // Does the id this layer was bound under still name a player that could own it? **A player id is
  // not a player**, and this is where that bites: `v visualsynth, display='hub75-01'` commented out
  // while a live `v scopefft` on another line carries the same id leaves players.getById('v')
  // answering perfectly well, so a check for mere existence never fires. The wall then keeps a
  // picture whose chain no longer exists anywhere in the code - and keeps *animating* it, because
  // the uniforms are re-evaluated from the dead event's params every frame. Only a visualsynth can
  // own a display layer, since setLayer is called from draw/visualsynth.js and nowhere else, so any
  // other type under that id means the layer is orphaned. The same fault made a live *edit* from
  // `v visualsynth, display=...` to `v scopefft` strand the wall just as permanently, with nothing
  // commented out at all.
  //
  // A visualsynth that has merely dropped its `display=` param is deliberately NOT caught here:
  // releaseFor() ends that one on its next event (draw/visualsynth.js), which is what stops an
  // ordinary re-edit of a live display line from blanking the wall for a beat on every Ctrl+Enter.
  let ownsDisplay = (playerId) => {
    let p = players.getById(playerId)
    return p !== undefined && String(p.type).toLowerCase() === 'visualsynth'
  }

  let release = (name) => {
    let entry = layers[name]
    if (entry) { delete byPlayer[entry.playerId] } // or a player ended by the poll below leaks its mapping
    delete layers[name]
    if (sessions[name]) { sessions[name].clearDesired() }
  }

  // Evaluate one layer's uniforms into a flat Float32Array in prog.uniforms order. That order is
  // the wire slot index (PROTOCOL.md 12.1), so this must not be reordered or filtered.
  let scratch = {}
  let evalUniforms = (live, beat) => {
    let us = live.uniforms
    let out = scratch[us.length]
    if (out === undefined) { out = scratch[us.length] = new Float32Array(us.length * 4) }
    for (let i = 0; i < us.length; i++) {
      let u = us[i]
      // Restore the call tree the arg was written in, exactly as draw/visualsynth.js does for the
      // local path: without it a uniform written inside a user defined visual function cannot
      // resolve its lambda args and silently evaluates to zero
      let outer = getCallTree()
      clearCallTree()
      setCallTree(u.callTree)
      let v
      try {
        v = evalParamFrame(u.ast, live.params, beat)
      } finally {
        clearCallTree()
        setCallTree(outer)
      }
      let q = toVec4(v) // a shared scratch array: copy it out before the next uniform overwrites it
      out[i*4] = q[0]; out[i*4+1] = q[1]; out[i*4+2] = q[2]; out[i*4+3] = q[3]
    }
    return out
  }

  let evalDim = (live, session, beat) => {
    if (live === undefined || live.params.dim === undefined) { return session.manualDim }
    let v = evalParamFrame(live.params.dim, live.params, beat)
    if (typeof v !== 'number' || !isFinite(v)) { return session.manualDim }
    return Math.max(0, Math.min(1, v))
  }

  // Once per animation frame from main.js. A frame packet goes out whether or not anything is
  // drawing: layerCount 0 is legal (PROTOCOL.md 12.1) and keeps dim, beat and hostTime live with no
  // content bound, which means one code path rather than two.
  let perFrameUpdate = (now, beat) => {
    let hostTime = audioSystem.timeNow()
    for (let name in sessions) {
      let session = sessions[name]
      let entry = layers[name]
      // The owning player going away - stopped, deleted, swept by players.gc_sweep, or replaced by
      // something of another type that happens to share its id - is what ends a layer. Layer
      // lifetime is per player, not per event (PROTOCOL.md 7.2): the wall holds its picture between
      // events, and animation comes from the uniform stream.
      if (entry !== undefined && !ownsDisplay(entry.playerId)) {
        release(name)
        entry = undefined
      }
      let bound = session.boundLayer()
      let live = (entry !== undefined && bound) ? entry.liveByKey.get(bound.key) : undefined
      let latest = entry !== undefined ? entry.liveByKey.get(entry.key) : undefined
      let values = null
      if (live !== undefined) {
        values = evalUniforms(live, beat)
        if (values.length / 4 !== bound.uniformCount) { values = null } // never disagree with the bound program
      }
      session.sendFrame(values, evalDim(latest, session, beat), beat, hostTime)
      session.pump()
      // Once a new chain is bound, the superseded one's params are dead weight
      if (entry !== undefined && bound && entry.liveByKey.size > 1) {
        entry.liveByKey.forEach((v, k) => {
          if (k !== bound.key && k !== entry.key) { entry.liveByKey.delete(k) }
        })
      }
    }
  }

  // ---- console commands ---------------------------------------------------------------------
  // For bring-up before any DSL exists: test patterns and the dimmer work with no shader at all.

  let forEachNamed = (name, f) => {
    let names = name ? [name] : Object.keys(sessions)
    if (names.length === 0) { consoleOut('🟠 hub75: no displays connected. Try: hub75 connect hub75-01') }
    names.forEach(n => {
      if (sessions[n]) { f(sessions[n], n) } else { consoleOut(`🟠 hub75: no display named ${n}`) }
    })
  }

  // The display's per-second pacing window (pi/pacing.h), as one line. `host` is limut's own send
  // cadence and `arrive` is what the network delivered, so the two together say which end a jerk
  // came from; the buckets are early / on time / 1 late / 2-4 late / stalled, in frames.
  let pacingLine = (p) => {
    if (!p) { return '' }
    let one = (name, g) => `${name} ${g.b.join('/')} max ${g.max.toFixed(1)}ms`
    return `\n  pacing: ${one('host', p.host)} | ${one('arrive', p.arrive)}` +
      ` | ${one('draw', p.draw)} | render mean ${p.render.mean.toFixed(2)} max ${p.render.max.toFixed(2)}ms` +
      (p.seqGaps ? ` | host skipped ${p.seqSkipped} in ${p.seqGaps} gaps` : '')
  }

  let status = () => {
    let names = Object.keys(sessions)
    if (names.length === 0) { return consoleOut('hub75: no displays. Try: hub75 connect hub75-01') }
    names.forEach(n => {
      let s = sessions[n]
      let d = (s.info && s.info.display) || {}
      let entry = layers[n]
      let bound = s.boundLayer()
      let st = s.stat
      consoleOut(`hub75 ${n} [${s.state}] ${s.endpoint.host}:${s.endpoint.port}` +
        (d.w ? ` ${d.w}x${d.h}` : '') +
        ` player ${entry ? entry.playerId : '-'}` +
        ` layer ${bound ? bound.progId.slice(0, 8) : '-'}` +
        // The shipped size, so "is this chain too big for the wire?" is answerable on demand
        // rather than only from the one line session.js prints when a program changes
        (s.progSize ? ` prog ${s.progSize.bytes}b/${s.progSize.uniforms}u` : '') +
        ` sent ${s.frames}${s.skipped ? ' skipped ' + s.skipped : ''}` +
        ` dim ${s.dim.toFixed(2)} cached ${s.sentIds.size}` +
        (st ? ` | display ${st.fps}fps drop ${st.dropped} ${st.renderMs}ms temp ${st.temp} throttled ${st.throttled}` : '') +
        (st ? pacingLine(st.pacing) : ''))
    })
  }

  consoleOut.addCommand('hub75', (args) => {
    let cmd = (args[0] || 'status').toLowerCase()
    if (cmd === 'status') { return status() }
    if (cmd === 'connect') {
      if (!args[1]) { return consoleOut('🟠 hub75 connect <name>') }
      getSession(args[1])
      return consoleOut(`hub75: connecting to ${args[1]}`)
    }
    if (cmd === 'test') {
      let pattern = (args[1] || 'off').toLowerCase()
      if (['bars', 'grid', 'off'].indexOf(pattern) === -1) { return consoleOut('🟠 hub75 test bars|grid|off [name]') }
      return forEachNamed(args[2], s => s.setTest(pattern))
    }
    if (cmd === 'dim') {
      let v = parseFloat(args[1])
      if (!isFinite(v)) { return consoleOut('🟠 hub75 dim 0..1 [name]') }
      return forEachNamed(args[2], s => s.setDim(v))
    }
    if (cmd === 'stop') {
      return forEachNamed(args[1], (s, n) => {
        s.stop(); release(n); delete sessions[n]; consoleOut(`hub75: stopped ${n}`)
      })
    }
    consoleOut('hub75: status | connect <name> | test bars|grid|off [name] | dim 0..1 [name] | stop [name]')
  })

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  let src = '#version 300 es\nvoid main() {}'
  let texA = {tex: {}, data: new Uint8Array(4), dims: 1, size: 1}
  let texB = {tex: {}, data: new Uint8Array(4), dims: 1, size: 1}

  // The same chain built twice is the same layer: nothing is resent for a repeated event
  assert(true, layerKey({source: src, textures: []}) === layerKey({source: src, textures: []}))

  // The 7.2 trap: byte-identical GLSL, different lut contents. If the key ignored the texture the
  // second chain would render with the first one's lut and nothing would report a problem.
  let one = layerKey({source: src, textures: [{texture: texA}]})
  let two = layerKey({source: src, textures: [{texture: texB}]})
  assert(false, one === two)
  assert(true, one === layerKey({source: src, textures: [{texture: texA}]})) // and stable per texture

  // A different shader is a different layer even with the same textures
  assert(false, one === layerKey({source: src + '\n', textures: [{texture: texA}]}))
  // Texture order is part of the key: swapping two units is a different picture
  assert(false, layerKey({source: src, textures: [{texture: texA}, {texture: texB}]}) ===
                layerKey({source: src, textures: [{texture: texB}, {texture: texA}]}))
  // A chain with no textures never collides with one that has them
  assert(false, layerKey({source: src, textures: []}) === one)

  // A player that has gone away must give the display up. Nothing else can: a commented out line
  // fires no more events, so releaseFor() can never run, and a socket close does not unbind either
  // (the layer is display state, PROTOCOL.md 7.2). A stub session, injected before setLayer so
  // getSession finds it and no real socket is ever opened.
  let stubSession = () => {
    let o = {desired: null, blanked: 0, frames: 0, manualDim: 1,
      setDesired: (d) => { o.desired = d }, clearDesired: () => { o.blanked++; o.desired = null },
      boundLayer: () => null, sendFrame: () => { o.frames++ }, pump: () => {}}
    return o
  }
  let beat = {count: 0, duration: 0.5}

  let sess = stubSession()
  sessions['not-a-real-display'] = sess
  let vp = {id: 'vtest', type: 'visualsynth'}
  players.instances['vtest'] = vp
  setLayer('not-a-real-display', {_player: vp}, {source: src, uniforms: [], textures: []})
  assert(true, sess.desired !== null) // bound while the player is alive
  perFrameUpdate(0, beat)
  assert(0, sess.blanked) // ...and left alone, frame after frame
  assert(1, sess.frames)
  delete players.instances['vtest'] // exactly what gc_sweep does to a commented out line
  perFrameUpdate(0, beat)
  assert(1, sess.blanked)
  perFrameUpdate(0, beat)
  assert(1, sess.blanked) // and only once - the layer entry is gone, so the poll is finished

  // The deterministic path, which draw/visualsynth.js's releasePlayer uses from the player type's
  // destroy hook: the same sweep that removes the player gives the wall up, no frame of latency
  let sess2 = stubSession()
  sessions['not-a-real-display-2'] = sess2
  let vp2 = {id: 'vtest2', type: 'visualsynth'}
  players.instances['vtest2'] = vp2
  setLayer('not-a-real-display-2', {_player: vp2}, {source: src, uniforms: [], textures: []})
  releaseFor('vtest2')
  assert(1, sess2.blanked)
  releaseFor('vtest2') // idempotent: the mapping went with it
  assert(1, sess2.blanked)
  delete players.instances['vtest2']
  perFrameUpdate(0, beat) // nothing left for the poll to find either
  assert(1, sess2.blanked)

  // An id is not a player. This is the one that mattered: the display bound line commented out
  // while another live line on another row carries the same id - `v scopefft` beside a commented
  // `v visualsynth, display=...` - which is an ordinary thing to have in a live coding file. The old
  // check asked only whether *something* answered to 'v', so the wall kept a picture whose chain was
  // gone, animating from the dead event's params, until Ctrl-. Nothing about it is browser specific.
  let sess3 = stubSession()
  sessions['not-a-real-display-3'] = sess3
  let vp3 = {id: 'vtest3', type: 'visualsynth'}
  players.instances['vtest3'] = vp3
  setLayer('not-a-real-display-3', {_player: vp3}, {source: src, uniforms: [], textures: []})
  perFrameUpdate(0, beat)
  assert(0, sess3.blanked)
  // gc_sweep replaced the visualsynth with a scope of the same name, rather than removing it
  players.instances['vtest3'] = {id: 'vtest3', type: 'scopefft'}
  perFrameUpdate(0, beat)
  assert(1, sess3.blanked)
  delete players.instances['vtest3']

  // And the same fault with nothing commented out at all: a live edit of the line's player type
  let sess4 = stubSession()
  sessions['not-a-real-display-4'] = sess4
  let vp4 = {id: 'vtest4', type: 'visualsynth'}
  players.instances['vtest4'] = vp4
  setLayer('not-a-real-display-4', {_player: vp4}, {source: src, uniforms: [], textures: []})
  players.instances['vtest4'] = {id: 'vtest4', type: 'play'} // now an audio player of the same name
  perFrameUpdate(0, beat)
  assert(1, sess4.blanked)
  delete players.instances['vtest4']

  // A visualsynth replaced by another visualsynth is NOT released here: the next event either
  // re-binds it or, if display= is gone from the line, releaseFor() ends it. Releasing on the
  // replacement itself would blank the wall for a beat on every Ctrl+Enter of a live display line.
  let sess5 = stubSession()
  sessions['not-a-real-display-5'] = sess5
  let vp5 = {id: 'vtest5', type: 'visualsynth'}
  players.instances['vtest5'] = vp5
  setLayer('not-a-real-display-5', {_player: vp5}, {source: src, uniforms: [], textures: []})
  players.instances['vtest5'] = {id: 'vtest5', type: 'visualsynth'} // re-parsed, a new object
  perFrameUpdate(0, beat)
  assert(0, sess5.blanked)
  delete players.instances['vtest5']

  delete sessions['not-a-real-display']
  delete sessions['not-a-real-display-2']
  delete sessions['not-a-real-display-3']
  delete sessions['not-a-real-display-4']
  delete sessions['not-a-real-display-5']

  console.log('Hub75 host tests complete')
  }

  return {
    setLayer: setLayer,
    releaseFor: releaseFor,
    perFrameUpdate: perFrameUpdate,
    status: status,
    layerKey: layerKey,
    sessions: sessions,
  }
})
