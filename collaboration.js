'use strict';
define(function (require) {
  let consoleOut = require('console')

  let connections = new Set()
  let registerConnection = (conn) => {
    conn.on('open', () => {
      connections.add(conn)
      consoleOut('🟢 Peer connected: ' + conn.peer)
    })
    conn.on('data', (data) => {
      if (data && typeof data === 'object' && data.type === 'say') {
        consoleOut(conn.peer + ': ' + data.message)
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

  consoleOut.addCommand('server', () => {
    consoleOut('> Starting peer.js server...')
    loadPeerScript().then(() => {
      let peer = new window.Peer()
      peer.on('open', (id) => {
        consoleOut('Peer session id: ' + id)
      })
      peer.on('connection', (conn) => {
        registerConnection(conn)
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
        registerConnection(peer.connect(targetId))
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

  return {}
})
