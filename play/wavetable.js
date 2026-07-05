'use strict';
define(function (require) {
  // Wavetable generation for superosc (and any future wavetable synth). All of
  // this runs on the main thread: the worklet only *consumes* the precomputed
  // per-frame integral table (sent over its message port), it never builds one.

  // Build the running integral of a single-cycle waveform: integral[k] is the
  // sum of samples [0..k-1] (so integral[0] === 0), and total is the sum of the
  // whole cycle. Accumulated in float64 for precision, stored as float32. The
  // worklet reads this integral (rather than the raw samples) to band-limit.
  const buildIntegral = (wave) => {
    const len = wave.length
    const integral = new Float32Array(len)
    let acc = 0
    for (let k = 0; k < len; k++) { integral[k] = acc; acc += wave[k] }
    return { integral, total: acc }
  }

  // Condition each single-cycle frame so it loops cleanly. A purpose-built wt64
  // file already loops seamlessly, but an ordinary sample (eg Apollo 11 audio)
  // sliced into frames has an arbitrary value/slope mismatch at each frame's wrap
  // seam: the audio that really followed data[off+N-1] is discarded and the loop
  // jumps back to data[off], so the reconstructed slope kinks every cycle -> a
  // click/buzz at the fundamental (plus aliasing). Returns a NEW Float32Array
  // (never mutates `data`, which is the shared getChannelData(0) buffer). Each
  // frame is (1) linearly detrended so its endpoints match, (2) given a cubic seam
  // bridge that matches value AND slope across the wrap so the looped cycle is
  // C1-continuous, and (3) DC-removed last (subtracting a constant, which preserves
  // the detrend/bridge) so the mean is truly ~0. `smooth` (0..1) dry/wet-blends the
  // conditioned frame against the raw frame.
  const conditionWave = (data, count, frameLen, smooth) => {
    const N = frameLen
    const out = new Float32Array(count * N)
    const cond = new Float32Array(N)
    // half-width of the seam bridge: a short fraction of a cycle, capped at N/4.
    const L = Math.max(1, Math.min(Math.round(N / 32), N >> 2))
    for (let f = 0; f < count; f++) {
      const off = f * N
      for (let k = 0; k < N; k++) { cond[k] = data[off + k] }
      // 1. linear endpoint detrend: subtract a ramp so cond[N-1] meets cond[0]
      if (N > 1) {
        const d = cond[N - 1] - cond[0]
        for (let k = 0; k < N; k++) { cond[k] -= d * k / (N - 1) }
      }
      // 2. cubic (Hermite) seam bridge: replace the 2L samples straddling the wrap
      // with a curve matching the value and interior slope at each anchor (index
      // N-1-L and index L, both left untouched), giving C1 continuity at the seam.
      if (N > 4) {
        const M = 2 * L + 1
        const p0 = cond[N - 1 - L], p1 = cond[L]
        const m0 = (cond[N - L] - cond[N - 1 - L]) * M
        const m1 = (cond[L] - cond[L - 1]) * M
        for (let u = 1; u <= 2 * L; u++) {
          const s = u / M, s2 = s * s, s3 = s2 * s
          const h = (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1
          const idx = u <= L ? (N - 1 - L + u) : (u - L - 1)
          cond[idx] = h
        }
      }
      // 3. DC removal (per frame) — done last so the detrend ramp and seam bridge
      // can't reintroduce an offset. Subtracting a constant preserves slope,
      // endpoint-matching, and seam continuity, so it only zeroes the mean.
      let sum = 0
      for (let k = 0; k < N; k++) { sum += cond[k] }
      const mean = sum / N
      for (let k = 0; k < N; k++) { cond[k] -= mean }
      // dry/wet blend against the raw frame
      for (let k = 0; k < N; k++) { out[off + k] = data[off + k] + (cond[k] - data[off + k]) * smooth }
    }
    return out
  }

  // A wt64-style wavetable file packs `count` single-cycle frames end-to-end in
  // one buffer (eg 64 frames of 256 samples). Slice the buffer into `count`
  // equal frames and build buildIntegral's running integral *per frame*: each
  // frame's segment of `integral` resets to 0 at the frame boundary, and
  // `totals[f]` is that frame's whole-cycle sum (its integral's per-cycle
  // increment). frameLen = floor(len/count); any remainder samples are ignored.
  // count===1 reproduces buildIntegral over the whole buffer (one frame). The
  // worklet lerps between adjacent frames to morph across the table. `smooth`>0
  // conditions each frame (see conditionWave) to de-click arbitrary samples; at
  // smooth===0 (the default) the raw shared buffer is used unchanged.
  const buildWavetable = (data, count, smooth = 0) => {
    count = Math.max(1, Math.floor(count) || 1)
    const frameLen = Math.floor(data.length / count)
    const s = smooth > 0 ? Math.min(1, smooth) : 0
    // Reads (band-limited integral AND the small-span point-read fallback) all use
    // `wave`, so conditioning it once here keeps both paths consistent.
    const wave = s > 0 ? conditionWave(data, count, frameLen, s) : data
    const integral = new Float32Array(count * frameLen)
    const totals = new Float32Array(count)
    for (let f = 0; f < count; f++) {
      let acc = 0
      const off = f * frameLen
      for (let k = 0; k < frameLen; k++) { integral[off + k] = acc; acc += wave[off + k] }
      totals[f] = acc
    }
    return { wave, integral, totals, frameLen, count }
  }

  // Cache built wavetables by (data buffer identity, frame count, smooth) so a
  // wavetable used by many notes computes its per-frame integral table once, not
  // per note. WeakMap-keyed on the sample data (a stable getChannelData(0)
  // reference, cached per url in play/samples.js) so entries are freed when the
  // AudioBuffer is collected. `smooth` is quantised to 2dp so automating it can't
  // grow the cache unboundedly. buildWavetable itself stays uncached (still used
  // directly by tests).
  const wavetableCache = new WeakMap() // data -> Map('count:smooth' -> built wavetable)
  const buildWavetableCached = (data, count, smooth = 0) => {
    count = Math.max(1, Math.floor(count) || 1) // normalise to match the cache key + buildWavetable
    smooth = smooth > 0 ? Math.min(1, Math.round(smooth * 100) / 100) : 0
    let byKey = wavetableCache.get(data)
    if (!byKey) { byKey = new Map(); wavetableCache.set(data, byKey) }
    const key = count + ':' + smooth
    let wt = byKey.get(key)
    if (!wt) { wt = buildWavetable(data, count, smooth); byKey.set(key, wt) }
    return wt
  }

  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual, msg) => {
      if (Math.abs(expected - actual) > 1e-4) {
        console.trace(`wavetable ${msg} Assertion failed. Expected ${expected}, got ${actual}`)
      }
    }

    // buildIntegral: cumulative sums and total
    let w = new Float32Array([1, 2, 3, 4])
    let { integral, total } = buildIntegral(w)
    assert(0, integral[0], 'I[0]')
    assert(1, integral[1], 'I[1]')
    assert(3, integral[2], 'I[2]')
    assert(6, integral[3], 'I[3]')
    assert(10, total, 'total')

    // quasi-periodic accessor: Ic(idx+len) === Ic(idx) + total
    let len = w.length
    let Ic = (idx) => { let cyc = Math.floor(idx / len); return integral[idx - cyc * len] + cyc * total }
    assert(Ic(1) + total, Ic(1 + len), 'quasi-periodic +len')
    assert(Ic(0) - total, Ic(-len), 'quasi-periodic -len')

    // box-mean identity: averaging the (cubically-interpolated) integral over an
    // exact whole cycle gives the cycle's mean (total/len), wherever it starts.
    let interpI = (x, base) => {
      let i0 = Math.floor(x), frac = x - i0
      let p0 = Ic(i0 - 1) - base, p1 = Ic(i0) - base, p2 = Ic(i0 + 1) - base, p3 = Ic(i0 + 2) - base
      let a = 3 * (p1 - p2) + p3 - p0, b = 2 * p0 - 5 * p1 + 4 * p2 - p3, c = p2 - p0
      return p1 + 0.5 * frac * (c + frac * (b + frac * a))
    }
    let boxMean = (x0, x1) => { let base = Ic(Math.floor(x0)); return (interpI(x1, base) - interpI(x0, base)) / (x1 - x0) }
    assert(total / len, boxMean(0.7, 0.7 + len), 'full-cycle mean')
    assert(total / len, boxMean(2.3, 2.3 + len), 'full-cycle mean offset')

    // buildWavetable: per-frame integrals reset at each frame boundary
    let wt2 = new Float32Array([1, 2, 3, 4, 10, 20, 30, 40]) // count=2 -> frameLen 4
    let r = buildWavetable(wt2, 2)
    assert(4, r.frameLen, 'wt frameLen')
    assert(2, r.count, 'wt count')
    assert(0, r.integral[0], 'wt I0[0]'); assert(1, r.integral[1], 'wt I0[1]')
    assert(3, r.integral[2], 'wt I0[2]'); assert(6, r.integral[3], 'wt I0[3]')
    assert(10, r.totals[0], 'wt total0')
    assert(0, r.integral[4], 'wt I1[0] resets'); assert(10, r.integral[5], 'wt I1[1]')
    assert(30, r.integral[6], 'wt I1[2]'); assert(60, r.integral[7], 'wt I1[3]')
    assert(100, r.totals[1], 'wt total1')

    // count===1 reproduces buildIntegral over the whole buffer
    let r1 = buildWavetable(w, 1)
    let bi = buildIntegral(w)
    assert(w.length, r1.frameLen, 'count1 frameLen')
    assert(bi.total, r1.totals[0], 'count1 total')
    for (let k = 0; k < w.length; k++) { assert(bi.integral[k], r1.integral[k], 'count1 I[' + k + ']') }

    // buildWavetableCached: same (data, count) returns the identical cached object;
    // a different count is a distinct object; the cached result matches buildWavetable.
    let cd = new Float32Array([1, 2, 3, 4, 10, 20, 30, 40])
    let c1 = buildWavetableCached(cd, 2)
    let c1b = buildWavetableCached(cd, 2)
    if (c1 !== c1b) { console.trace('buildWavetableCached same (data,count) should be cached') }
    let c2 = buildWavetableCached(cd, 4)
    if (c1 === c2) { console.trace('buildWavetableCached different count should differ') }
    // equivalent counts (2 vs 2.4) normalise to the same cache slot
    if (buildWavetableCached(cd, 2.4) !== c1) { console.trace('buildWavetableCached equivalent count should share slot') }
    let cdirect = buildWavetable(cd, 2)
    assert(cdirect.frameLen, c1.frameLen, 'cached frameLen matches direct')
    assert(cdirect.totals[0], c1.totals[0], 'cached total0 matches direct')
    assert(cdirect.totals[1], c1.totals[1], 'cached total1 matches direct')
    for (let k = 0; k < cdirect.integral.length; k++) { assert(cdirect.integral[k], c1.integral[k], 'cached I[' + k + '] matches direct') }

    // smooth conditioning. smooth===0 (and omitted) is the identity: same shared
    // `wave` reference and byte-identical integral/totals as the raw build, so
    // existing wt64 tables and sounds are untouched.
    let sw = new Float32Array(64) // one 64-sample frame with DC + a big wrap-seam jump
    for (let k = 0; k < 64; k++) { sw[k] = 0.3 + Math.sin(2 * Math.PI * k / 64) + (k / 63) * 0.8 }
    let s0 = buildWavetable(sw, 1, 0)
    let s0raw = buildWavetable(sw, 1)
    if (s0.wave !== sw) { console.trace('smooth=0 should reuse the shared data buffer') }
    for (let k = 0; k < sw.length; k++) { assert(s0raw.integral[k], s0.integral[k], 'smooth=0 I[' + k + '] unchanged') }

    // smooth===1: fresh conditioned buffer (data untouched), DC removed (total~0),
    // endpoints matched, and slope continuous across the wrap seam (the click fix).
    let sdata0 = sw[0], sdataN = sw[63]
    let s1 = buildWavetable(sw, 1, 1)
    if (s1.wave === sw) { console.trace('smooth=1 should allocate a fresh conditioned buffer') }
    assert(sdata0, sw[0], 'smooth=1 must not mutate source [0]'); assert(sdataN, sw[63], 'smooth=1 must not mutate source [N-1]')
    if (Math.abs(s1.totals[0]) > 1e-3) { console.trace('smooth=1 DC should be ~0, got ' + s1.totals[0]) }
    // slope continuity: the seam kink (the second difference straddling the wrap,
    // ie how much the slope jumps) should be far smaller than the raw sample's. The
    // bridge makes wave[N-1] -> wave[0] a smooth step, not equal values (which would
    // be a flat spot), so it's the slope discontinuity, not the endpoints, that matters.
    let rawKink = Math.abs((sw[0] - sw[63]) - (sw[63] - sw[62]))
    let condKink = Math.abs((s1.wave[0] - s1.wave[63]) - (s1.wave[63] - s1.wave[62]))
    if (!(condKink < rawKink * 0.5)) { console.trace('smooth=1 should reduce the seam slope kink: cond ' + condKink + ' vs raw ' + rawKink) }

    // per-frame box-mean identity still holds on the conditioned integral (the
    // worklet relies on it regardless of conditioning).
    let sflen = s1.frameLen
    let IcS = (idx) => { let cyc = Math.floor(idx / sflen); return s1.integral[idx - cyc * sflen] + cyc * s1.totals[0] }
    let interpIS = (x, base) => {
      let i0 = Math.floor(x), frac = x - i0
      let p0 = IcS(i0 - 1) - base, p1 = IcS(i0) - base, p2 = IcS(i0 + 1) - base, p3 = IcS(i0 + 2) - base
      let a = 3 * (p1 - p2) + p3 - p0, b = 2 * p0 - 5 * p1 + 4 * p2 - p3, c = p2 - p0
      return p1 + 0.5 * frac * (c + frac * (b + frac * a))
    }
    let baseS = IcS(3); assert(s1.totals[0] / sflen, (interpIS(3 + sflen, baseS) - interpIS(3, baseS)) / sflen, 'smooth=1 box-mean identity')

    // cache: distinct smooth values are distinct entries; same key is shared.
    let sc = new Float32Array(sw)
    let scA = buildWavetableCached(sc, 1, 1), scAb = buildWavetableCached(sc, 1, 1)
    if (scA !== scAb) { console.trace('buildWavetableCached same smooth should be cached') }
    if (buildWavetableCached(sc, 1, 0) === scA) { console.trace('buildWavetableCached different smooth should differ') }

    // per-frame box-mean identity: averaging a frame's interpolated integral over
    // a whole cycle gives that frame's mean (totals[f]/frameLen), as the worklet relies on.
    let flen = r.frameLen
    let IcF = (idx, f) => { let cyc = Math.floor(idx / flen); return r.integral[f * flen + (idx - cyc * flen)] + cyc * r.totals[f] }
    let interpIF = (x, base, f) => {
      let i0 = Math.floor(x), frac = x - i0
      let p0 = IcF(i0 - 1, f) - base, p1 = IcF(i0, f) - base, p2 = IcF(i0 + 1, f) - base, p3 = IcF(i0 + 2, f) - base
      let a = 3 * (p1 - p2) + p3 - p0, b = 2 * p0 - 5 * p1 + 4 * p2 - p3, c = p2 - p0
      return p1 + 0.5 * frac * (c + frac * (b + frac * a))
    }
    let boxMeanF = (x0, x1, f) => { let base = IcF(Math.floor(x0), f); return (interpIF(x1, base, f) - interpIF(x0, base, f)) / (x1 - x0) }
    assert(r.totals[0] / flen, boxMeanF(0.7, 0.7 + flen, 0), 'frame0 full-cycle mean')
    assert(r.totals[1] / flen, boxMeanF(2.3, 2.3 + flen, 1), 'frame1 full-cycle mean')

    console.log('wavetable tests complete')
  }

  return { buildIntegral, buildWavetable, buildWavetableCached }
})
