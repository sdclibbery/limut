'use strict'
define(function (require) {

  // Content addressing for the hub75 protocol: ids are the lowercase hex SHA-256 of the bytes,
  // truncated to 16 characters (draw/hub75/PROTOCOL.md §6).
  //
  // crypto.subtle is the obvious implementation, but it only exists in a *secure context*. Limut on
  // http://localhost:8000 is one; limut opened from another machine on http://192.168.x.x:8000 is
  // not, and there crypto.subtle is simply undefined. That would fail as an unrelated-looking
  // TypeError deep in the upload path, so there is a plain JS fallback below rather than a
  // mysterious break the first time someone opens the page over the LAN.

  let K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ])

  let rotr = (x, n) => (x >>> n) | (x << (32 - n))

  // Plain FIPS 180-4 SHA-256 over a Uint8Array, returning lowercase hex
  let sha256js = (bytes) => {
    let h = new Uint32Array([
      0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19])
    let len = bytes.length
    let withPad = new Uint8Array((((len + 9) + 63) & ~63))
    withPad.set(bytes)
    withPad[len] = 0x80
    // Length in bits as a 64 bit big endian value. Only the low 32 bits can matter here (a 512MB
    // asset would be absurd), but write both words so the padding is correct by construction.
    let bits = len * 8
    let dv = new DataView(withPad.buffer)
    dv.setUint32(withPad.length - 8, Math.floor(bits / 0x100000000), false)
    dv.setUint32(withPad.length - 4, bits >>> 0, false)

    let w = new Uint32Array(64)
    for (let off = 0; off < withPad.length; off += 64) {
      for (let i = 0; i < 16; i++) { w[i] = dv.getUint32(off + i*4, false) }
      for (let i = 16; i < 64; i++) {
        let s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15] >>> 3)
        let s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2] >>> 10)
        w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0
      }
      let a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7]
      for (let i = 0; i < 64; i++) {
        let S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25)
        let ch = (e & f) ^ (~e & g)
        let t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0
        let S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22)
        let maj = (a & b) ^ (a & c) ^ (b & c)
        let t2 = (S0 + maj) >>> 0
        hh=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0
      }
      h[0]=(h[0]+a)>>>0; h[1]=(h[1]+b)>>>0; h[2]=(h[2]+c)>>>0; h[3]=(h[3]+d)>>>0
      h[4]=(h[4]+e)>>>0; h[5]=(h[5]+f)>>>0; h[6]=(h[6]+g)>>>0; h[7]=(h[7]+hh)>>>0
    }
    let out = ''
    for (let i = 0; i < 8; i++) { out += h[i].toString(16).padStart(8, '0') }
    return out
  }

  let toHex = (buf) => {
    let b = new Uint8Array(buf)
    let out = ''
    for (let i = 0; i < b.length; i++) { out += b[i].toString(16).padStart(2, '0') }
    return out
  }

  let subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : undefined

  // Always a promise, whichever path is taken, so callers have one shape to handle
  let sha256hex = (bytes) => {
    if (subtle) {
      // Pass a fresh copy: subtle.digest wants a plain buffer, and a Uint8Array view into a larger
      // buffer (which a chunked asset may be) would otherwise hash the whole thing
      return subtle.digest('SHA-256', bytes.slice().buffer).then(toHex)
    }
    return Promise.resolve(sha256js(bytes))
  }

  // The wire id: the first 16 hex characters (PROTOCOL.md §6)
  let sha256id = (bytes) => sha256hex(bytes).then(h => h.slice(0, 16))

  let utf8 = (str) => new TextEncoder().encode(str)

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }

  // FIPS 180-4 test vectors, against the plain JS implementation
  assert('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', sha256js(new Uint8Array(0)))
  assert('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', sha256js(utf8('abc')))
  assert('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    sha256js(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))) // 56 bytes: forces a second block
  assert('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    sha256js(new Uint8Array(1000000).fill(0x61))) // a million 'a'
  assert(64, sha256js(utf8('x')).length) // always 64 hex characters, never short of leading zeroes
  // A hash with leading zero bytes still prints its full width: a naive toString(16) drops them,
  // and a short id would collide with nothing on the display and simply never match its cache
  assert('002039854ec711160f280a46fac2c12f2b0c1149a1add04fcd24b7df8a5f9c1c', sha256js(utf8('limut157')))

  // A view into a larger buffer hashes only its own bytes, whichever path runs
  let big = new Uint8Array(64)
  big.set(utf8('abc'), 8)
  assert('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', sha256js(big.subarray(8, 11)))
  sha256hex(big.subarray(8, 11)).then(h =>
    assert('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', h))

  // The two paths agree, and the id is the truncation of the full hash
  sha256hex(utf8('abc')).then(h => assert(sha256js(utf8('abc')), h))
  sha256id(utf8('abc')).then(id => assert('ba7816bf8f01cfea', id))

  console.log('Hub75 sha256 tests complete')
  }

  return {
    sha256hex: sha256hex,
    sha256id: sha256id,
    sha256js: sha256js,
    utf8: utf8,
    haveSubtle: !!subtle,
  }
})
