'use strict';
define(function (require) {
  let consoleOut = require('console')
  let editor = require('editor-codemirror')
  let metronome = require('metronome')
  let system = require('play/system')
  let gamepads = require('player/gamepad')

  let isServer = false
  let connections = new Set()

  let snapshotPad = (pad) => {
    if (!pad) { return null }
    return {
      id: pad.id,
      mapping: pad.mapping,
      axes: Array.from(pad.axes),
      buttons: Array.from(pad.buttons).map(b => ({ value: b.value, pressed: b.pressed, touched: b.touched })),
      connected: true,
    }
  }

  let registerConnection = (conn, sendCodeOnOpen) => {
    conn.on('open', () => {
      connections.add(conn)
      consoleOut('🟢 Peer connected: ' + conn.peer)
      if (sendCodeOnOpen) {
        conn.send({ type: 'code', code: editor.getValue() })
      }
      let localPads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? Array.from(navigator.getGamepads()) : []
      let initial = []
      localPads.forEach((pad, i) => {
        let snap = snapshotPad(pad)
        if (snap) { initial.push({ idx: i, pad: snap }) }
      })
      if (initial.length > 0) { conn.send({ type: 'gamepad', pads: initial }) }
    })
    conn.on('data', (data) => {
      if (data && typeof data === 'object' && data.type === 'say') {
        consoleOut(conn.peer + ': ' + data.message)
      } else if (data && typeof data === 'object' && data.type === 'code') {
        editor.setValue(data.code)
        consoleOut('📝 Code received from ' + conn.peer)
      } else if (data && typeof data === 'object' && data.type === 'codechange') {
        editor.applyChange(data)
      } else if (data && typeof data === 'object' && data.type === 'sync') {
        metronome.sync(data.beatTime, data.bpm)
      } else if (data && typeof data === 'object' && data.type === 'gamepad') {
        if (Array.isArray(data.pads)) {
          data.pads.forEach((entry) => {
            if (entry && typeof entry.idx === 'number') {
              gamepads.setRemotePad(conn.peer, entry.idx, entry.pad || null)
            }
          })
        }
      }
    })
    conn.on('close', () => {
      connections.delete(conn)
      gamepads.clearPeer(conn.peer)
      consoleOut('⚪ Peer disconnected: ' + conn.peer)
    })
    conn.on('error', (err) => {
      consoleOut('🔴 Connection error: ' + err)
      console.log(err)
    })
  }

  let peerScriptLoading
  let loadPeerScript = () => {
    if (window.Peer) { return Promise.resolve() }
    if (peerScriptLoading) { return peerScriptLoading }
    peerScriptLoading = new Promise((resolve, reject) => {
      let script = document.createElement('script')
      script.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Failed to load peer.js'))
      document.head.appendChild(script)
    })
    return peerScriptLoading
  }

  let codeChangeListenerRegistered = false
  let registerCodeChangeListener = () => {
    if (codeChangeListenerRegistered) { return }
    codeChangeListenerRegistered = true
    editor.onChange((change) => {
      if (connections.size === 0) { return }
      let msg = {
        type: 'codechange',
        from: { line: change.from.line, ch: change.from.ch },
        to: { line: change.to.line, ch: change.to.ch },
        text: change.text,
      }
      connections.forEach((conn) => { if (conn.open) { conn.send(msg) } })
    })
  }

  consoleOut.addCommand('server', (args) => {
    let requestedId = args[0]
    consoleOut('> Starting peer.js server...')
    isServer = true
    registerCodeChangeListener()
    loadPeerScript().then(() => {
      let peer = requestedId ? new window.Peer(requestedId) : new window.Peer()
      peer.on('open', (id) => {
        consoleOut('Peer session id: ' + id)
      })
      peer.on('connection', (conn) => {
        registerConnection(conn, true)
      })
      peer.on('error', (err) => {
        consoleOut('🔴 Peer error: ' + err)
        console.log(err)
      })
    }).catch((err) => {
      consoleOut('🔴 ' + err.message)
      console.log(err)
    })
  })

  consoleOut.addCommand('connect', (args) => {
    let targetId = args[0]
    if (!targetId) {
      consoleOut('🔴 Usage: connect <guid>')
      return
    }
    consoleOut('> Connecting to ' + targetId + '...')
    loadPeerScript().then(() => {
      let peer = new window.Peer()
      peer.on('open', () => {
        registerConnection(peer.connect(targetId), false)
      })
      peer.on('error', (err) => {
        consoleOut('🔴 Peer error: ' + err)
        console.log(err)
      })
    }).catch((err) => {
      consoleOut('🔴 ' + err.message)
      console.log(err)
    })
  })

  consoleOut.addCommand('say', (args, line) => {
    let message = line.slice(line.indexOf(' ') + 1).trim()
    if ((message.startsWith("'") && message.endsWith("'")) ||
        (message.startsWith('"') && message.endsWith('"'))) {
      message = message.slice(1, -1)
    }
    if (!message) {
      consoleOut("🔴 Usage: say 'message'")
      return
    }
    if (connections.size === 0) {
      consoleOut('🔴 No peers connected')
      return
    }
    connections.forEach((conn) => {
      if (conn.open) { conn.send({ type: 'say', message: message }) }
    })
    consoleOut('You: ' + message)
  })

  let broadcastSync = () => {
    if (!isServer) { return }
    if (connections.size === 0) { return }
    let msg = {
      type: 'sync',
      beatTime: metronome.beatTime(system.timeNow()),
      bpm: metronome.bpm(),
    }
    connections.forEach((conn) => {
      if (conn.open) { conn.send(msg) }
    })
  }

  let lastSentPads = []
  let padSnapshotsEqual = (a, b) => {
    if (!a && !b) { return true }
    if (!a || !b) { return false }
    if (a.mapping !== b.mapping || a.id !== b.id) { return false }
    if (a.axes.length !== b.axes.length) { return false }
    for (let i = 0; i < a.axes.length; i++) {
      if (Math.abs(a.axes[i] - b.axes[i]) > 0.001) { return false }
    }
    if (a.buttons.length !== b.buttons.length) { return false }
    for (let i = 0; i < a.buttons.length; i++) {
      if (Math.abs(a.buttons[i].value - b.buttons[i].value) > 0.001) { return false }
      if (!!a.buttons[i].pressed !== !!b.buttons[i].pressed) { return false }
    }
    return true
  }
  let broadcastGamepads = () => {
    if (connections.size === 0) { return }
    let pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? Array.from(navigator.getGamepads()) : []
    let len = Math.max(pads.length, lastSentPads.length)
    let changes = []
    for (let i = 0; i < len; i++) {
      let snap = snapshotPad(pads[i])
      if (!padSnapshotsEqual(snap, lastSentPads[i])) {
        changes.push({ idx: i, pad: snap })
        lastSentPads[i] = snap
      }
    }
    if (changes.length === 0) { return }
    let msg = { type: 'gamepad', pads: changes }
    connections.forEach((conn) => {
      if (conn.open) { conn.send(msg) }
    })
  }

  return { broadcastSync: broadcastSync, broadcastGamepads: broadcastGamepads }
})
