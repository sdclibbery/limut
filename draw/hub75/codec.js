'use strict'
// Binary packet codec for the limut <-> HUB75 protocol. See draw/hub75/PROTOCOL.md §12.
//
// Dual AMD/CommonJS so the limut host side can require it as a module later without a second
// copy of the byte layout — the layout living in exactly one place is the point of this file.
;(function (factory) {
  if (typeof define === 'function' && define.amd) { define(factory) }
  else { module.exports = factory() }
})(function () {

  let PACKET_FRAME = 0x01
  let PACKET_CHUNK = 0x02
  let FRAME_HEADER = 24 // bytes before the first layer
  let LAYER_HEADER = 4 // layerId + uniformCount
  let CHUNK_HEADER = 4
  let CHUNK_SIZE = 16384

  // A layer's uniforms may be given flat ([x,y,z,w, x,y,z,w]) or nested ([[x,y,z,w], ...]).
  // The host produces 4-element arrays from toVec4(), so accept both rather than making every
  // caller flatten.
  let flatten = (uniforms) => {
    if (uniforms === undefined || uniforms === null) { return [] }
    if (uniforms.length > 0 && uniforms[0] !== undefined && uniforms[0].length !== undefined) {
      let out = []
      for (let i = 0; i < uniforms.length; i++) {
        let u = uniforms[i]
        out.push(u[0] || 0, u[1] || 0, u[2] || 0, u[3] || 0)
      }
      return out
    }
    return uniforms
  }

  let encodeFrame = (f) => {
    let layers = (f.layers || []).map(l => ({ id: l.id || 0, values: flatten(l.uniforms) }))
    layers.forEach(l => {
      if (l.values.length % 4 !== 0) { throw new Error('uniform values must come in fours') }
    })
    let size = FRAME_HEADER + layers.reduce((n, l) => n + LAYER_HEADER + l.values.length * 4, 0)
    let buf = new ArrayBuffer(size)
    let dv = new DataView(buf)
    dv.setUint8(0, PACKET_FRAME)
    dv.setUint8(1, layers.length)
    dv.setUint16(2, 0, true) // flags, reserved
    dv.setUint32(4, f.seq >>> 0, true)
    dv.setFloat32(8, f.dim === undefined ? 1 : f.dim, true)
    dv.setFloat32(12, f.beat || 0, true)
    dv.setFloat64(16, f.hostTime || 0, true)
    let off = FRAME_HEADER
    layers.forEach(l => {
      dv.setUint16(off, l.id, true)
      dv.setUint16(off + 2, l.values.length / 4, true)
      off += LAYER_HEADER
      for (let i = 0; i < l.values.length; i++) {
        dv.setFloat32(off, l.values[i], true)
        off += 4
      }
    })
    return new Uint8Array(buf)
  }

  let decodeFrame = (bytes) => {
    let dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (bytes.byteLength < FRAME_HEADER) { throw new Error('frame packet truncated') }
    if (dv.getUint8(0) !== PACKET_FRAME) { throw new Error('not a frame packet') }
    let flags = dv.getUint16(2, true)
    if (flags !== 0) { throw new Error('frame flags must be zero in proto 1') }
    let out = {
      layerCount: dv.getUint8(1),
      seq: dv.getUint32(4, true),
      dim: dv.getFloat32(8, true),
      beat: dv.getFloat32(12, true),
      hostTime: dv.getFloat64(16, true),
      layers: [],
    }
    let off = FRAME_HEADER
    for (let i = 0; i < out.layerCount; i++) {
      if (off + LAYER_HEADER > bytes.byteLength) { throw new Error('frame packet truncated in layer header') }
      let id = dv.getUint16(off, true)
      let count = dv.getUint16(off + 2, true)
      off += LAYER_HEADER
      if (off + count * 16 > bytes.byteLength) { throw new Error('frame packet truncated in uniforms') }
      let values = new Float32Array(count * 4)
      for (let j = 0; j < values.length; j++) {
        values[j] = dv.getFloat32(off, true)
        off += 4
      }
      out.layers.push({ id: id, uniformCount: count, values: values })
    }
    if (off !== bytes.byteLength) { throw new Error('frame packet has trailing bytes') }
    return out
  }

  let encodeChunk = (index, payload) => {
    if (payload.length > CHUNK_SIZE) { throw new Error('chunk payload too big') }
    let out = new Uint8Array(CHUNK_HEADER + payload.length)
    let dv = new DataView(out.buffer)
    dv.setUint8(0, PACKET_CHUNK)
    dv.setUint8(1, 0) // reserved
    dv.setUint16(2, index, true)
    out.set(payload, CHUNK_HEADER)
    return out
  }

  let decodeChunk = (bytes) => {
    if (bytes.byteLength < CHUNK_HEADER) { throw new Error('chunk packet truncated') }
    let dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (dv.getUint8(0) !== PACKET_CHUNK) { throw new Error('not a chunk packet') }
    if (dv.getUint8(1) !== 0) { throw new Error('chunk reserved byte must be zero') }
    return {
      index: dv.getUint16(2, true),
      payload: bytes.subarray(CHUNK_HEADER),
    }
  }

  let packetType = (bytes) => bytes.byteLength > 0 ? bytes[0] : -1

  return {
    PACKET_FRAME, PACKET_CHUNK, FRAME_HEADER, LAYER_HEADER, CHUNK_HEADER, CHUNK_SIZE,
    encodeFrame, decodeFrame, encodeChunk, decodeChunk, packetType, flatten,
  }
})
