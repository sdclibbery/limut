'use strict'
define(function (require) {
  let codec = require('draw/hub75/codec')

  // Turning a visualsynth texture into a wire asset (draw/hub75/PROTOCOL.md §6). Pure: no GL and no
  // sockets, so it tests inline — the same split draw/visualsynth/lut.js keeps between sampleLut
  // and uploadLut.
  //
  // Only three texture sources can reach a px chain, and only one of them is shippable today:
  //
  //   tex1d/2d/3d  -> kind 'lut', the raw RGBA8 bytes lut.js sampled. Supported.
  //   tex{'url'}   -> kind 'image', the *encoded* file bytes. Not in this version: draw/texture.js
  //                   keeps only the GL handle, so the bytes would have to be fetched separately.
  //   tex{webcam{}}-> a live capture device. Inherently local; PROTOCOL.md §6 rules it out entirely.
  //
  // The two unsupported cases are reported rather than skipped. A layer that silently dropped a
  // texture would render with whatever was in that unit before, which is exactly the wrong-picture
  // failure the protocol is built to avoid.
  let classify = (t) => {
    if (t === undefined || t === null) { return {unsupported: 'missing'} }
    // A texture with an update() re-uploads itself every frame: it is a live source, and the
    // protocol has no per frame texture path. Today that means only webcam. Note it is update()
    // and not .video that identifies one: draw/webcam.js attaches the video element inside
    // update(), which draw/sprite.js calls - and sprite.js never runs for a display bound player,
    // so .video would still be undefined here and a webcam would be misreported as an image.
    if (typeof t.update === 'function') { return {unsupported: 'webcam'} }
    if (t.data !== undefined && t.dims !== undefined && t.size !== undefined) {
      return {kind: 'lut', dims: t.dims, size: t.size, bytes: t.data}
    }
    return {unsupported: 'image'} // a GL handle with no retained bytes: draw/texture.js
  }

  let unsupportedReason = {
    webcam: 'a webcam texture cannot be sent to a display: it is a local capture device',
    image: "an image texture (tex{'url'}) cannot be sent to a display yet",
    missing: 'a texture that is not ready yet',
  }

  // How many 16KB chunks an asset of this size takes. Zero bytes is still one (empty) chunk, so the
  // display always sees at least one and the announce/chunk handshake has no special case.
  let chunkCount = (byteLength) => Math.max(1, Math.ceil(byteLength / codec.CHUNK_SIZE))

  let chunkAt = (bytes, index) => bytes.subarray(index * codec.CHUNK_SIZE,
                                                 Math.min(bytes.length, (index + 1) * codec.CHUNK_SIZE))

  // The `asset` announce for a classified lut (§6.1)
  let announce = (id, a) => ({
    type: 'asset', id: id, kind: a.kind,
    dims: a.dims, size: a.size,
    bytes: a.bytes.length, chunks: chunkCount(a.bytes.length),
  })

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  // A lut texture as draw/visualsynth/lut.js uploadLut now returns it
  let lut = {tex: {}, data: new Uint8Array(1024), dims: 1, size: 256}
  assert({kind:'lut', dims:1, size:256}, (({kind,dims,size}) => ({kind,dims,size}))(classify(lut)))
  assert(true, classify(lut).bytes === lut.data) // the sampled bytes themselves, not a copy

  // A 3d lut carries its own shape, which is what tells the display the stride to upload with
  let lut3 = {tex: {}, target: 'TEXTURE_3D', data: new Uint8Array(16*16*16*4), dims: 3, size: 16}
  assert('lut', classify(lut3).kind)
  assert([3, 16, 16384], [classify(lut3).dims, classify(lut3).size, classify(lut3).bytes.length])

  // The two unsupported sources are distinguished, so the warning can say which one
  assert('image', classify({tex:{}, width:1024, height:1024}).unsupported) // draw/texture.js shape
  assert('missing', classify(undefined).unsupported)
  // A webcam texture as draw/webcam.js getWebcamTexture returns it: update() is there from the
  // start, width/height/video only appear once sprite.js has drawn a frame - which never happens
  // for a display bound player, so classifying on .video would call this an image
  assert('webcam', classify({tex:{}, update: () => {}}).unsupported)
  assert('webcam', classify({tex:{}, update: () => {}, video:{}, width:640, height:480}).unsupported)
  // A live source stays unshippable even if it somehow also carried bytes
  assert('webcam', classify({tex:{}, update: () => {}, data:new Uint8Array(4), dims:1, size:1}).unsupported)

  // Chunk maths (§6.2): the boundaries are where an off by one shows as a hash mismatch
  assert(1, chunkCount(0))
  assert(1, chunkCount(1))
  assert(1, chunkCount(16384))
  assert(2, chunkCount(16385))
  assert(2, chunkCount(32768))
  assert(3, chunkCount(32769))
  assert(64, chunkCount(1024*1024)) // a 1MB asset

  // Only the last chunk may be short, and the pieces reassemble to the original
  let bytes = new Uint8Array(16384 + 7)
  for (let i = 0; i < bytes.length; i++) { bytes[i] = i & 0xff }
  assert(2, chunkCount(bytes.length))
  assert(16384, chunkAt(bytes, 0).length)
  assert(7, chunkAt(bytes, 1).length)
  let rejoined = new Uint8Array(bytes.length)
  rejoined.set(chunkAt(bytes, 0), 0)
  rejoined.set(chunkAt(bytes, 1), 16384)
  assert(Array.from(bytes), Array.from(rejoined))

  // The announce is what the display checks the arriving bytes against, so its counts must agree
  let ann = announce('3f9a1c2b7d4e5061', classify(lut))
  assert({type:'asset', id:'3f9a1c2b7d4e5061', kind:'lut', dims:1, size:256, bytes:1024, chunks:1}, ann)
  assert(ann.bytes, 256*4) // dims/size and the byte count agree: the display rejects a lut if they don't

  console.log('Hub75 assets tests complete')
  }

  return {
    classify: classify,
    unsupportedReason: unsupportedReason,
    chunkCount: chunkCount,
    chunkAt: chunkAt,
    announce: announce,
  }
})
