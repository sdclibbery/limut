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

  let release = (name) => {
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
      // The owning player going away - stopped, deleted, or swept by players.gc_sweep - is what
      // ends a layer. Layer lifetime is per player, not per event (PROTOCOL.md 7.2): the wall holds
      // its picture between events, and animation comes from the uniform stream.
      if (entry !== undefined && players.getById(entry.playerId) === undefined) {
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
        ` sent ${s.frames} dim ${s.dim.toFixed(2)} cached ${s.sentIds.size}` +
        (st ? ` | display ${st.fps}fps drop ${st.dropped} ${st.renderMs}ms temp ${st.temp} throttled ${st.throttled}` : ''))
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
