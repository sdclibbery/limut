'use strict'
// Minimal RFC 6455 server, no dependencies, built on node:http's upgrade event.
//
// This is deliberately small, because it is also a statement of how much WebSocket the Pi
// renderer has to implement in C. draw/hub75/PROTOCOL.md §3 constrains the protocol so that
// everything below is sufficient: no extensions, no fragmentation, no messages over 60 KB.
//
// Everything a compliant implementation needs and nothing it doesn't: the sha1+base64 handshake,
// unmasking, the four opcodes we use, and a close handshake.

let crypto = require('node:crypto')

let GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11' // RFC 6455 §1.3, fixed by the standard
let MAX_MESSAGE = 60 * 1024 // PROTOCOL.md §3: nothing on this wire is ever bigger

let OP = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa }

// Close codes we actually use
let CLOSE_NORMAL = 1000
let CLOSE_PROTOCOL = 1002
let CLOSE_TOO_BIG = 1009

let acceptKey = (key) => crypto.createHash('sha1').update(key + GUID).digest('base64')

// One connection. Emits through the callbacks the caller assigns: onMessage(data, isBinary),
// onClose(code, reason). Nothing here is an EventEmitter — the state machine is small enough
// that plain callbacks stay clearer, and it mirrors what the C side will look like.
class Conn {
  constructor (socket) {
    this.socket = socket
    this.buf = Buffer.alloc(0)
    this.closed = false
    this.onMessage = () => {}
    this.onClose = () => {}
    this.bytesIn = 0
    this.bytesOut = 0

    socket.on('data', (chunk) => {
      this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
      this.bytesIn += chunk.length
      try {
        this.drain()
      } catch (e) {
        this.fail(CLOSE_PROTOCOL, String(e && e.message || e))
      }
    })
    socket.on('error', () => this.finish(1006, 'socket error'))
    socket.on('close', () => this.finish(1006, 'socket closed'))
  }

  // Parse as many whole frames as the buffer holds. Returns when a partial frame is left over.
  drain () {
    for (;;) {
      let b = this.buf
      if (b.length < 2) { return }
      let fin = (b[0] & 0x80) !== 0
      let rsv = b[0] & 0x70
      let opcode = b[0] & 0x0f
      let masked = (b[1] & 0x80) !== 0
      let len = b[1] & 0x7f
      let off = 2
      if (rsv !== 0) { throw new Error('reserved bits set (no extensions are negotiated)') }
      if (len === 126) {
        if (b.length < off + 2) { return }
        len = b.readUInt16BE(off); off += 2
      } else if (len === 127) {
        if (b.length < off + 8) { return }
        let big = b.readBigUInt64BE(off); off += 8
        if (big > BigInt(MAX_MESSAGE)) { throw new Error('message too big') }
        len = Number(big)
      }
      if (len > MAX_MESSAGE) { this.fail(CLOSE_TOO_BIG, 'message too big'); return }
      // A client frame must be masked (RFC 6455 §5.1). Browsers always mask; an unmasked frame
      // means something is wrong on the other end, not something to be lenient about.
      if (!masked) { throw new Error('client frame not masked') }
      if (b.length < off + 4 + len) { return }
      let mask = b.subarray(off, off + 4); off += 4
      let payload = Buffer.allocUnsafe(len)
      for (let i = 0; i < len; i++) { payload[i] = b[off + i] ^ mask[i & 3] }
      off += len
      this.buf = b.subarray(off)

      if (opcode === OP.CONT || !fin) {
        // PROTOCOL.md §3 forbids fragmentation precisely so neither end needs a reassembly path
        throw new Error('fragmented messages are not supported')
      }
      if (opcode === OP.TEXT) { this.onMessage(payload.toString('utf8'), false) }
      else if (opcode === OP.BINARY) { this.onMessage(payload, true) }
      else if (opcode === OP.PING) { this.frame(OP.PONG, payload) }
      else if (opcode === OP.PONG) { /* liveness only */ }
      else if (opcode === OP.CLOSE) {
        let code = payload.length >= 2 ? payload.readUInt16BE(0) : CLOSE_NORMAL
        let reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : ''
        this.frame(OP.CLOSE, payload.subarray(0, 2))
        this.socket.end()
        this.finish(code, reason)
        return
      } else {
        throw new Error('unknown opcode 0x' + opcode.toString(16))
      }
      if (this.closed) { return }
    }
  }

  // Server frames are never masked (RFC 6455 §5.1)
  frame (opcode, payload) {
    if (this.closed) { return }
    payload = payload || Buffer.alloc(0)
    let len = payload.length
    let head
    if (len < 126) {
      head = Buffer.allocUnsafe(2)
      head[1] = len
    } else if (len < 65536) {
      head = Buffer.allocUnsafe(4)
      head[1] = 126
      head.writeUInt16BE(len, 2)
    } else {
      head = Buffer.allocUnsafe(10)
      head[1] = 127
      head.writeBigUInt64BE(BigInt(len), 2)
    }
    head[0] = 0x80 | opcode // always FIN
    this.bytesOut += head.length + len
    this.socket.write(Buffer.concat([head, payload]))
  }

  send (data) {
    if (typeof data === 'string') { this.frame(OP.TEXT, Buffer.from(data, 'utf8')) }
    else { this.frame(OP.BINARY, Buffer.from(data)) }
  }

  sendJson (obj) { this.send(JSON.stringify(obj)) }

  ping () { this.frame(OP.PING, Buffer.alloc(0)) }

  close (code, reason) {
    if (this.closed) { return }
    let payload = Buffer.alloc(2 + Buffer.byteLength(reason || '', 'utf8'))
    payload.writeUInt16BE(code === undefined ? CLOSE_NORMAL : code, 0)
    if (reason) { payload.write(reason, 2, 'utf8') }
    this.frame(OP.CLOSE, payload)
    this.socket.end()
    this.finish(code === undefined ? CLOSE_NORMAL : code, reason || '')
  }

  fail (code, reason) {
    try { this.close(code, reason) } catch (e) { this.finish(code, reason) }
  }

  finish (code, reason) {
    if (this.closed) { return }
    this.closed = true
    try { this.socket.destroy() } catch (e) {}
    this.onClose(code, reason)
  }
}

// Handle the HTTP upgrade on `path`. onConnection(conn, req) gets a live Conn.
let attach = (server, path, onConnection) => {
  server.on('upgrade', (req, socket, head) => {
    let url = (req.url || '').split('?')[0]
    let key = req.headers['sec-websocket-key']
    if (url !== path || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    // No Sec-WebSocket-Extensions in the response: PROTOCOL.md §3 forbids negotiating any,
    // permessage-deflate included, so the display never has to inflate anything.
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + acceptKey(key) + '\r\n\r\n')
    socket.setNoDelay(true) // 60Hz packets of ~100 bytes: Nagle would coalesce them into jitter
    let conn = new Conn(socket)
    if (head && head.length) { socket.emit('data', head) }
    onConnection(conn, req)
  })
}

module.exports = { attach, Conn, acceptKey, MAX_MESSAGE, OP }
