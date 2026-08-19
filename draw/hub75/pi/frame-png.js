'use strict'
// Grab the display's current frame and write it as a PNG, for looking at.
//
//   node draw/hub75/pi/frame-png.js [host:port] [out.png] [scale]
//
// /frame.raw serves the frame as it left the output stage — dimmer and gamma already applied —
// so this is what the panels would be showing, not what the shader produced. Zero dependencies:
// node's zlib does the only hard part of a PNG.

let fs = require('node:fs')
let zlib = require('node:zlib')

let EP = process.argv[2] || 'hub75-01.local:7575'
let OUT = process.argv[3] || 'frame.png'
let SCALE = parseInt(process.argv[4] || '4', 10)

let crc32 = (buf) => {
  let table = crc32.table || (crc32.table = (() => {
    let t = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) { c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1) }
      t[n] = c
    }
    return t
  })())
  let c = -1
  for (let i = 0; i < buf.length; i++) { c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8) }
  return (c ^ -1) >>> 0
}

let chunk = (type, data) => {
  let len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  let body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  let crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

let png = (w, h, rgba) => {
  let ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8      // bit depth
  ihdr[9] = 6      // RGBA
  // Each scanline is prefixed with a filter byte; 0 means none, which is all this needs.
  let raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Nearest neighbour, so a 128x64 panel is legible without inventing colours between pixels
let upscale = (w, h, rgba, s) => {
  let out = Buffer.alloc(w * s * h * s * 4)
  for (let y = 0; y < h * s; y++) for (let x = 0; x < w * s; x++) {
    rgba.copy(out, (y * w * s + x) * 4, (((y / s) | 0) * w + ((x / s) | 0)) * 4, (((y / s) | 0) * w + ((x / s) | 0)) * 4 + 4)
  }
  return out
}

;(async () => {
  let res = await fetch(`http://${EP}/frame.raw`)
  if (!res.ok) { throw new Error(`/frame.raw returned ${res.status}`) }
  let w = +res.headers.get('x-width'), h = +res.headers.get('x-height')
  let px = Buffer.from(await res.arrayBuffer())
  let s = Math.max(1, SCALE)
  fs.writeFileSync(OUT, png(w * s, h * s, upscale(w, h, px, s)))
  console.log(`${OUT}: ${w}x${h} panel, written at ${w * s}x${h * s} ` +
              `(frame ${res.headers.get('x-frames')}, gamma ${res.headers.get('x-gamma')})`)
})().catch(e => { console.error('🔴', e.message); process.exit(1) })
