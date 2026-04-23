'use strict';
define(function (require) {
  let consoleOut = require('console')
  let editor = require('editor-codemirror')
  let metronome = require('metronome')
  let system = require('play/system')

  let isServer = false
  let connections = new Set()
  let registerConnection = (conn, sendCodeOnOpen) => {
    conn.on('open', () => {
      connections.add(conn)
      consoleOut('🟢 Peer connected: ' + conn.peer)
      if (sendCodeOnOpen) {
        conn.send({ type: 'code', code: editor.getValue() })
      }
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
      }
    })
    conn.on('close', () => {
      connections.delete(conn)
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

  consoleOut.addCommand('server', () => {
    consoleOut('> Starting peer.js server...')
    isServer = true
    registerCodeChangeListener()
    loadPeerScript().then(() => {
      let peer = new window.Peer()
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

  return { broadcastSync: broadcastSync }
})
