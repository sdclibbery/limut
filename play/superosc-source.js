'use strict';
define(function (require) {
  // Build the running integral of a single-cycle waveform: integral[k] is the
  // sum of samples [0..k-1] (so integral[0] === 0), and total is the sum of the
  // whole cycle. Accumulated in float64 for precision, stored as float32. The
  // worklet reads this integral (rather than the raw samples) to band-limit.
  // (Declared before the AudioWorkletNode guard so its tests run everywhere.)
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
  // frame is (1) DC-removed, (2) linearly detrended so its endpoints match, and
  // (3) given a cubic seam bridge that matches value AND slope across the wrap so
  // the looped cycle is C1-continuous. `smooth` (0..1) dry/wet-blends the
  // conditioned frame against the raw frame.
  const conditionWave = (data, count, frameLen, smooth) => {
    const N = frameLen
    const out = new Float32Array(count * N)
    const cond = new Float32Array(N)
    // half-width of the seam bridge: a short fraction of a cycle, capped at N/4.
    const L = Math.max(1, Math.min(Math.round(N / 32), N >> 2))
    for (let f = 0; f < count; f++) {
      const off = f * N
      // 1. DC removal (per frame)
      let sum = 0
      for (let k = 0; k < N; k++) { sum += data[off + k] }
      const mean = sum / N
      for (let k = 0; k < N; k++) { cond[k] = data[off + k] - mean }
      // 2. linear endpoint detrend: subtract a ramp so cond[N-1] meets cond[0]
      if (N > 1) {
        const d = cond[N - 1] - cond[0]
        for (let k = 0; k < N; k++) { cond[k] -= d * k / (N - 1) }
      }
      // 3. cubic (Hermite) seam bridge: replace the 2L samples straddling the wrap
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

  // Per-voice frequency multipliers for `n` unison voices detuned by max
  // frequency ratio `ratio`, spread evenly (geometrically, ie by pitch) each
  // side of the primary frequency. Voice v gets exponent p in [-1,+1] spread
  // evenly across the voices, and multiplier ratio^p: the extremes sit at
  // ratio (top) and 1/ratio (bottom), the centre voice at 1 (the primary).
  // n===1 gives [1] (no detune). Kept in sync with the same formula inlined in
  // the worklet's process() (the worklet can't share this module's code).
  const unisonMuls = (n, ratio) => {
    const mul = new Float32Array(n)
    for (let v = 0; v < n; v++) {
      const p = n === 1 ? 0 : (2 * v / (n - 1) - 1)
      mul[v] = Math.pow(ratio, p)
    }
    return mul
  }

  // Per-voice amplitude weights for `n` unison voices, so the centre voice(s)
  // can be louder or softer than the outer ones. `amp` is the ratio of the
  // centre voice's amplitude to the outermost voices'; the weight interpolates
  // linearly by |position| p (p in [-1,+1] as in unisonMuls): amp at the centre
  // (p=0), 1 at the extremes (|p|=1). For even n no voice sits exactly at the
  // centre, so the two innermost voices are the loudest (both near amp). amp===1
  // gives all-ones (the plain unison sum). Loudness is held roughly constant by
  // scaling the summed voices by 1/sqrt(sum(w^2)) (see unisonGain), which for
  // amp===1 reduces to the previous 1/sqrt(n). Kept in sync with the same
  // formula inlined in the worklet's process().
  const unisonAmps = (n, amp) => {
    const w = new Float32Array(n)
    for (let v = 0; v < n; v++) {
      const p = n === 1 ? 0 : (2 * v / (n - 1) - 1)
      w[v] = 1 + (amp - 1) * (1 - Math.abs(p))
    }
    return w
  }

  // Overall output gain for a set of per-voice amplitude weights: 1/sqrt(sum w^2)
  // keeps the incoherent-sum loudness constant as the weights change (guarding a
  // zero/negative sum -> 0). For all-ones weights this is 1/sqrt(n).
  const unisonGain = (w) => {
    let sumSq = 0
    for (let v = 0; v < w.length; v++) { sumSq += w[v] * w[v] }
    return sumSq > 0 ? 1 / Math.sqrt(sumSq) : 0
  }

  // Per-voice equal-power stereo pan gains for `n` unison voices spread across a
  // stereo width `pan`. Voice v's pitch position p in [-1,+1] (as in unisonMuls)
  // maps to a pan position pp = p*pan clamped to [-1,+1], so the outermost voices
  // sit at ±pan (eg pan=1/2 -> 50% left..50% right) and the centre at 0. An
  // equal-power law (angle = (pp+1)*PI/4) sets the left/right gains, scaled by
  // sqrt(2) so a centred voice is exactly 1 in each channel (so pan=0, and
  // unison=1, leave the output unchanged) while each voice's total power stays
  // constant as it pans out (l^2+r^2 = 2 for every voice). Returns { l, r }
  // Float32Arrays. Kept in sync with the same formula inlined in the worklet's
  // process().
  const unisonPans = (n, pan) => {
    const l = new Float32Array(n)
    const r = new Float32Array(n)
    for (let v = 0; v < n; v++) {
      const p = n === 1 ? 0 : (2 * v / (n - 1) - 1)
      let pp = p * pan
      if (pp < -1) { pp = -1 } else if (pp > 1) { pp = 1 }
      const angle = (pp + 1) * Math.PI / 4
      l[v] = Math.SQRT2 * Math.cos(angle)
      r[v] = Math.SQRT2 * Math.sin(angle)
    }
    return { l, r }
  }

  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual, msg) => {
      if (Math.abs(expected - actual) > 1e-4) {
        console.trace(`superosc ${msg} Assertion failed. Expected ${expected}, got ${actual}`)
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

    // unisonMuls: geometric detune spread each side of the primary
    let m1 = unisonMuls(1, 1.1)
    assert(1, m1.length, 'uni n=1 length'); assert(1, m1[0], 'uni n=1 centre')
    let m2 = unisonMuls(2, 1.1)
    assert(1 / 1.1, m2[0], 'uni n=2 low'); assert(1.1, m2[1], 'uni n=2 high')
    let m3 = unisonMuls(3, 1.1)
    assert(1 / 1.1, m3[0], 'uni n=3 low'); assert(1, m3[1], 'uni n=3 centre'); assert(1.1, m3[2], 'uni n=3 high')
    // symmetry: mul[v] * mul[n-1-v] === 1 (geometric, so log-symmetric about primary)
    let m5 = unisonMuls(5, 1.03)
    for (let v = 0; v < 5; v++) { assert(1, m5[v] * m5[5 - 1 - v], 'uni n=5 symmetry ' + v) }
    // ratio===1: no detune, all voices at the primary
    let mr = unisonMuls(4, 1)
    for (let v = 0; v < 4; v++) { assert(1, mr[v], 'uni ratio=1 voice ' + v) }

    // unisonAmps: centre voice `amp`x the outer voices, linear by |position|
    let a3 = unisonAmps(3, 2)
    assert(1, a3[0], 'amp n=3 low'); assert(2, a3[1], 'amp n=3 centre'); assert(1, a3[2], 'amp n=3 high')
    // amp===1: all voices equal weight (the plain unison sum)
    let ae = unisonAmps(4, 1)
    for (let v = 0; v < 4; v++) { assert(1, ae[v], 'amp amp=1 voice ' + v) }
    // even n: the two innermost voices are the loudest and symmetric, the outer
    // pair the quietest and symmetric
    let a4 = unisonAmps(4, 3)
    assert(a4[1], a4[2], 'amp n=4 centre pair equal')
    assert(a4[0], a4[3], 'amp n=4 outer pair equal')
    assert(1, a4[0], 'amp n=4 outer = 1')
    if (!(a4[1] > a4[0])) { console.trace('amp n=4 centre louder than outer failed') }
    // amp<1: centre softer than the outer voices
    let as = unisonAmps(3, 0.5)
    assert(0.5, as[1], 'amp<1 centre'); assert(1, as[0], 'amp<1 outer')

    // unisonGain: 1/sqrt(sum w^2); all-ones reduces to 1/sqrt(n)
    assert(1 / Math.sqrt(4), unisonGain(unisonAmps(4, 1)), 'gain amp=1 n=4 = 1/sqrt(n)')
    assert(1, unisonGain(unisonAmps(1, 1)), 'gain n=1 = 1')
    // single voice: weight `amp` cancels against the gain, so output is unchanged
    assert(1, unisonAmps(1, 3)[0] * unisonGain(unisonAmps(1, 3)), 'gain n=1 amp cancels')

    // unisonPans: equal-power spread, centre = 1 in each channel, outers at ±pan
    let p1 = unisonPans(1, 0.5)
    assert(1, p1.l[0], 'pan n=1 left = 1'); assert(1, p1.r[0], 'pan n=1 right = 1')
    // pan=0: every voice centred, so all gains are 1 (no spread)
    let p0 = unisonPans(3, 0)
    for (let v = 0; v < 3; v++) { assert(1, p0.l[v], 'pan=0 left ' + v); assert(1, p0.r[v], 'pan=0 right ' + v) }
    // pan=1, n=3: extremes hard left/right (sqrt(2), 0), centre equal (1, 1)
    let p3 = unisonPans(3, 1)
    assert(Math.SQRT2, p3.l[0], 'pan n=3 v0 left'); assert(0, p3.r[0], 'pan n=3 v0 right')
    assert(1, p3.l[1], 'pan n=3 centre left'); assert(1, p3.r[1], 'pan n=3 centre right')
    assert(0, p3.l[2], 'pan n=3 v2 left'); assert(Math.SQRT2, p3.r[2], 'pan n=3 v2 right')
    // pan=1/2: n=2 outermost voices sit at 50% left..50% right (voice0 p=-1 ->
    // pp=-0.5, voice1 p=+1 -> pp=+0.5); the right voice leans right (R>L) and mirrors the left
    let ph = unisonPans(2, 0.5)
    let aHi = (0.5 + 1) * Math.PI / 4, aLo = (-0.5 + 1) * Math.PI / 4
    assert(Math.SQRT2 * Math.sin(aHi), ph.r[1], 'pan=1/2 right voice R gain')
    assert(Math.SQRT2 * Math.cos(aHi), ph.l[1], 'pan=1/2 right voice L gain')
    assert(Math.SQRT2 * Math.sin(aLo), ph.r[0], 'pan=1/2 left voice R gain')
    assert(Math.SQRT2 * Math.cos(aLo), ph.l[0], 'pan=1/2 left voice L gain')
    // symmetry (l[v] === r[n-1-v]) and constant total power (l^2+r^2 === 2)
    let p5 = unisonPans(5, 0.8)
    for (let v = 0; v < 5; v++) {
      assert(p5.l[v], p5.r[5 - 1 - v], 'pan n=5 symmetry ' + v)
      assert(2, p5.l[v] * p5.l[v] + p5.r[v] * p5.r[v], 'pan n=5 constant power ' + v)
    }

    // unison clamp (mirrors the worklet's process()): round, then clamp to 1..16.
    // Crucially a NaN unison must fall back to 1, not slip past both bounds as NaN.
    let clampUnison = (x) => { let n = Math.round(x); if (!(n >= 1)) { n = 1 } else if (n > 16) { n = 16 } return n }
    assert(1, clampUnison(NaN), 'uni clamp NaN -> 1')
    assert(1, clampUnison(0), 'uni clamp 0 -> 1')
    assert(1, clampUnison(-5), 'uni clamp negative -> 1')
    assert(16, clampUnison(99), 'uni clamp >16 -> 16')
    assert(4, clampUnison(4), 'uni clamp 4 -> 4')
    assert(3, clampUnison(3.4), 'uni clamp rounds 3.4 -> 3')

    // sync phase remap (mirrors the worklet's process()): sync !== 0 remaps the
    // steady-state phase to (phase * |sync|) % 1 (negative sync uses the same
    // ratio magnitude, only the reset is crossfaded); sync === 0 is a no-op.
    let syncPhase = (ph, sync) => (sync !== 0 ? (ph * Math.abs(sync)) % 1 : ph)
    assert(0.25, syncPhase(0.25, 0), 'sync=0 no-op')
    assert(0.5, syncPhase(0.25, 2), 'sync=2 wraps within cycle')
    assert(0, syncPhase(0.5, 2), 'sync=2 restarts at boundary')
    assert(0.25, syncPhase(0.75, 3), 'sync=3 second restart')
    // negative sync: identical magnitude remap in steady state as the positive ratio
    assert(0.5, syncPhase(0.25, -2), 'sync=-2 steady state matches +2')
    assert(0, syncPhase(0.5, -2), 'sync=-2 boundary matches +2')
    assert(0.25, syncPhase(0.75, -3), 'sync=-3 steady state matches +3')

    // soft-sync crossfade weight (mirrors the worklet): raised cosine of the
    // new-phase progress g in [0,1]; 0 at the reset (fully old), 1 at the fade
    // end (fully new), 1/2 at the midpoint. The sample-to-sample fade progression
    // is stateful across process() and is not covered by these pure helpers.
    let softFadeWeight = (g) => 0.5 - 0.5 * Math.cos(Math.PI * g)
    assert(0, softFadeWeight(0), 'soft fade w(0) = old')
    assert(1, softFadeWeight(1), 'soft fade w(1) = new')
    assert(0.5, softFadeWeight(0.5), 'soft fade w(1/2) = half')

    // soft-sync old-phase seed (mirrors the worklet): at a fundamental wrap the
    // continued old slave phase ((wrappedPhase + 1) * |sync|) % 1 stays continuous
    // with the pre-reset slave phase advanced by one increment (so no click).
    let seedOld = (phWrapped, sync) => ((phWrapped + 1) * Math.abs(sync)) % 1
    let sInc = 0.01, sMag = 3, phPre = 0.994    // pre-wrap fundamental phase
    let phPost = (phPre + sInc) % 1             // wrapped fundamental phase (0.004)
    let contPre = ((phPre + sInc) * sMag) % 1   // old slave phase, continued
    assert(contPre, seedOld(phPost, -sMag), 'soft sync seed continuous across wrap')

    // soft-sync fade length (mirrors the worklet): about maxK samples, capped to a
    // quarter of the fundamental cycle 1/incV, guarding incV === 0 -> 0.
    let syncFadeLen = (incV, maxK) => { let cyc = incV > 0 ? 1 / incV : 0; let k = Math.round(Math.min(maxK, 0.25 * cyc)); return k > 0 ? k : 0 }
    assert(96, syncFadeLen(0.0001, 96), 'soft fade len low note -> maxK')
    assert(0, syncFadeLen(0, 96), 'soft fade len incV=0 guard -> 0')
    assert(25, syncFadeLen(0.01, 96), 'soft fade len high note -> quarter cycle')

    // crush is expressed in bits: crush>0 -> 2^crush quantisation levels, crush===0
    // is off (mirrors the worklet: crushLevels then floor(phase*levels)/levels).
    let crushLevels = (bits) => (bits > 0 ? Math.pow(2, bits) : 0)
    assert(0, crushLevels(0), 'crush=0 bits -> off')
    assert(8, crushLevels(3), 'crush=3 bits -> 8 levels')
    assert(4096, crushLevels(12), 'crush=12 bits -> 4096 levels (old max)')
    // low-level phase quantiser (operates on a level count): floor(ph*levels)/levels,
    // levels===0 is a no-op.
    let crushPhase = (ph, levels) => (levels > 0 ? Math.floor(ph * levels) / levels : ph)
    assert(0.37, crushPhase(0.37, 0), 'levels=0 no-op')
    assert(0.25, crushPhase(0.37, 4), 'levels=4 quantises down')
    assert(0.5, crushPhase(0.7, 4), 'levels=4 quantises 0.7')
    assert(0.5, crushPhase(0.9, 2), 'levels=2 two steps')
    assert(0, crushPhase(0.9, 1), 'levels=1 collapses to 0')
    // bits->levels feeds the same quantiser: crush=3 bits === old crush=8 levels.
    assert(crushPhase(0.7, 8), crushPhase(0.7, crushLevels(3)), 'crush=3 bits == 8 levels')

    // pwm phase power-warp (mirrors the worklet's process()): the phase is
    // raised to the power 2^pwm; pwm===0 is a no-op (exponent 2^0 = 1).
    let pwmPhase = (ph, pwm) => (pwm !== 0 ? Math.pow(ph, Math.pow(2, pwm)) : ph)
    assert(0.37, pwmPhase(0.37, 0), 'pwm=0 no-op')
    assert(0.25, pwmPhase(0.5, 1), 'pwm=1 squares (0.5^2)')
    assert(0.5, pwmPhase(0.25, -1), 'pwm=-1 sqrt (0.25^0.5)')

    // formant read phase (mirrors the worklet's process()): formant !== 0
    // compresses the read phase to (phase * 2^formant) % 1; formant === 0 is a
    // no-op. The read span is scaled by the same 2^formant (not covered here).
    let formantReadPhase = (ph, formant) => (formant !== 0 ? (ph * Math.pow(2, formant)) % 1 : ph)
    assert(0.3, formantReadPhase(0.3, 0), 'formant=0 read no-op')
    assert(0.6, formantReadPhase(0.3, 1), 'formant=1 doubles read phase')
    assert(0.2, formantReadPhase(0.6, 1), 'formant=1 wraps read phase')
    assert(0.15, formantReadPhase(0.3, -1), 'formant=-1 halves read phase')
    // formant window (mirrors the worklet): raised cosine over the fundamental
    // phase, 0 at the cycle boundaries and 1 at mid-cycle; formant === 0 is a
    // no-op (window 1), so the read passes through untouched.
    let formantWindow = (phFund, formant) => (formant !== 0 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * phFund) : 1)
    assert(1, formantWindow(0.25, 0), 'formant=0 window no-op')
    assert(0, formantWindow(0, 1), 'formant window zero at cycle start')
    assert(1, formantWindow(0.5, 1), 'formant window peak at mid-cycle')
    assert(0, formantWindow(1, 1), 'formant window zero at cycle end')

    console.log('superosc tests complete')
  }

  if (!window.AudioWorkletNode) { return () => {} }

  let system = require('play/system')

  // The audio worklet processor. This runs on the audio thread, so it is
  // defined as a source string and registered via addModule below.
  // "superosc" is a wavetable oscillator: its wavetable is a sample buffer
  // (channel-0 Float32 data) sent in via the message port, sliced into `count`
  // single-cycle frames. Phase accumulation indexes within one frame; the `wt`
  // param morphs (lerps) across the frames. It is intended to grow lots more
  // functionality over time.
  const source = `
/* globals sampleRate, registerProcessor, AudioWorkletProcessor */

const DEFAULT_FREQUENCY = 440;
const DEFAULT_DETUNE = 0;

// helper: an a-rate param array is either length 1 (constant) or 128 (per-sample)
const paramGetter = (param) =>
  param.length > 1 ? (n) => param[n] : () => param[0];

class SuperOsc extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'frequency',
        defaultValue: DEFAULT_FREQUENCY,
        minValue: -0.5 * sampleRate,
        maxValue: 0.5 * sampleRate,
        automationRate: 'a-rate',
      },
      {
        name: 'detune',
        defaultValue: DEFAULT_DETUNE,
        minValue: -153600,
        maxValue: 153600,
        automationRate: 'a-rate',
      },
      // wt: morph position across the wavetable's frames, normalised 0..1
      // (0 = first frame, 1 = last frame), lerping between adjacent frames.
      { name: 'wt', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      // sync: oscillator hard-sync ratio. 0 disables it (no effect); otherwise
      // the phase is remapped phase -> (phase * |sync|) % 1 before the wavetable
      // lookup, so the waveform restarts |sync| times per fundamental cycle.
      // sync > 0 is the classic hard-sync timbre (a value discontinuity, ie a
      // click, at the fundamental boundary for non-integer sync). sync < 0 uses
      // the same ratio magnitude but softens that reset with a short raised-
      // cosine crossfade (a "soft sync"). Read a-rate so it can be modulated.
      { name: 'sync', defaultValue: 0, minValue: -32, maxValue: 32, automationRate: 'a-rate' },
      // crush: phase quantisation (a "bitcrush" of the phase). 0 disables it (no
      // effect); otherwise the phase (after any sync remap) is quantised to
      // crush discrete steps via floor(phase * crush) / crush before the
      // wavetable lookup, stepping the waveform for a lo-fi/aliased timbre.
      // Read a-rate so it can be modulated.
      { name: 'crush', defaultValue: 0, minValue: 0, maxValue: 12, automationRate: 'a-rate' },
      // pwm: phase power-warp ("generalised PWM"). The phase (after any sync
      // remap) is raised to the power 2^pwm before the wavetable lookup,
      // skewing the waveform toward its start (pwm>0) or end (pwm<0). 0 is a
      // no-op (exponent 2^0 = 1). Read a-rate so it can be modulated.
      { name: 'pwm', defaultValue: 0, minValue: -8, maxValue: 8, automationRate: 'a-rate' },
      // formant: formant/warp shift (a-rate). 0 disables it (no effect). Otherwise
      // the waveform is resampled within each fundamental cycle: read at 2^formant
      // times the rate (wrapped within the cycle, and the box-filter span scaled to
      // match, like sync) and multiplied by a raised-cosine window over the
      // fundamental phase. The window forces the signal to zero at every cycle
      // boundary, so the fundamental period (the pitch) is preserved while the
      // spectral formants shift up (formant > 0) or down (formant < 0), the way
      // Serum/Vital formant warp behaves.
      { name: 'formant', defaultValue: 0, minValue: -4, maxValue: 4, automationRate: 'a-rate' },
      // unison: number of detuned voices (1..16) layered together. unisonRatio
      // is the max frequency ratio the voices are detuned by, spread evenly
      // (geometrically) each side of the primary freq. Both read k-rate (once
      // per block, at [0]). unisonRatio's descriptor default is only a fallback;
      // the synth/node-fn actually set 1.01 when unison>1.
      { name: 'unison', defaultValue: 1, minValue: 1, maxValue: 16 },
      { name: 'unisonRatio', defaultValue: 1.01, minValue: 1, maxValue: 4 },
      // unisonAmp: ratio of the centre voice's amplitude to the outermost
      // voices' (1 = all equal). Weights interpolate linearly by pitch position;
      // overall loudness is held roughly constant via 1/sqrt(sum w^2). Read
      // k-rate (once per block, at [0]).
      { name: 'unisonAmp', defaultValue: 1, minValue: 0, maxValue: 8 },
      // unisonPan: stereo width of the voice spread. Voice pitch position p in
      // [-1,+1] maps to pan position p*pan (clamped to [-1,+1]): the outermost
      // voices sit at ±pan (eg pan=1/2 -> 50% left..50% right), the centre at 0.
      // Equal-power law, scaled so a centred voice is 1 in each channel. Read
      // k-rate (once per block, at [0]).
      { name: 'unisonPan', defaultValue: 0.5, minValue: -4, maxValue: 4 },
      // start/stop gates, driven by the node's start()/stop() methods
      { name: 'start', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'stop', defaultValue: 0, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    // Per-voice phase (cycles [0,1) within a single frame), one per unison voice
    // (up to 16). Voice 0 starts at 0 (so unison=1 is identical to a single
    // oscillator); the rest start spread across the cycle so the voices don't
    // begin perfectly coherent.
    this.phases = new Float32Array(16);
    for (let v = 1; v < 16; v++) { this.phases[v] = v / 16; }
    // Soft-sync (negative sync) per-voice crossfade state. When a fundamental
    // cycle wraps we arm a short raised-cosine crossfade between the OLD slave
    // phase (continued past the reset) and the NEW reset slave phase, softening
    // the hard-sync click. syncFade[v] is the samples remaining in the current
    // fade (0 = not fading), syncK[v] the length it was armed with, syncOldPh[v]
    // the continuing old slave-phase accumulator. All default to 0 (not fading).
    this.syncOldPh = new Float32Array(16);
    this.syncFade = new Float32Array(16);
    this.syncK = new Float32Array(16);
    this.wave = null; // wavetable sample data (Float32Array of channel-0 samples, count frames end-to-end)
    this.integral = null; // per-frame running integrals (for band-limited reads)
    this.totals = null; // per-frame cycle sums (each frame's integral per-cycle increment)
    this.frameLen = 0; // samples per frame (one cycle)
    this.count = 0; // number of frames in the wavetable
    // The wavetable (raw samples + precomputed per-frame integrals) is delivered
    // from the main thread via the message port.
    this.port.onmessage = (e) => {
      this.wave = e.data.wave;
      this.integral = e.data.integral;
      this.totals = e.data.totals;
      this.frameLen = e.data.frameLen;
      this.count = e.data.count;
    };
  }

  process(inputs, outputs, parameters) {
    // not started yet: stay alive, output silence
    if (parameters.start[0] < 0.5) { return true }
    // stopped: output silence and let the node be garbage collected
    if (parameters.stop[0] > 0.5) { return false }

    const output = outputs[0];
    const getFrequency = paramGetter(parameters.frequency);
    const getDetune = paramGetter(parameters.detune);
    const getWt = paramGetter(parameters.wt);
    const getSync = paramGetter(parameters.sync);
    const getCrush = paramGetter(parameters.crush);
    const getPwm = paramGetter(parameters.pwm);
    const getFormant = paramGetter(parameters.formant);
    const wave = this.wave;
    const integral = this.integral;
    const totals = this.totals;
    const frameLen = this.frameLen;
    const count = this.count;
    const haveWave = wave && frameLen > 0;

    // Unison: n detuned voices summed together (read k-rate, once per block).
    // mul[v] is voice v's frequency multiplier, spread geometrically each side
    // of the primary by max ratio (extremes at ratio and 1/ratio, centre at 1).
    // amp[v] is voice v's amplitude weight, letting the centre voice(s) be
    // louder/softer than the outer ones: unisonAmp is the centre-to-outer ratio,
    // interpolated linearly by pitch position (unisonAmp at centre, 1 at the
    // extremes). gain = 1/sqrt(sum amp^2) keeps loudness roughly constant; for
    // unisonAmp=1 that reduces to 1/sqrt(n), and unison=1 stays unchanged.
    // panL[v]/panR[v] are voice v's equal-power stereo gains: pitch position p
    // maps to pan position p*unisonPan (clamped to ±1), scaled so a centred voice
    // is 1 in each channel (so pan=0, and unison=1, stay unchanged) and each
    // voice's total power (l^2+r^2) is a constant 2 regardless of pan.
    let n = Math.round(parameters.unison[0]);
    // Written as !(n >= 1) so a NaN unison (eg a bad param expression) falls back
    // to 1 rather than slipping past both bounds and leaving n === NaN (silent).
    if (!(n >= 1)) { n = 1 } else if (n > 16) { n = 16 }
    const ratio = parameters.unisonRatio[0];
    let ampRatio = parameters.unisonAmp[0];
    // NaN/negative amp ratio falls back to 1 (equal voices) rather than silence.
    if (!(ampRatio >= 0)) { ampRatio = 1 }
    let pan = parameters.unisonPan[0];
    // A non-finite pan (NaN from a bad expression, or Infinity zeroing the centre
    // voice via 0*Infinity) falls back to the default spread rather than silence.
    if (!Number.isFinite(pan)) { pan = 0.5 }
    const mul = new Float32Array(n);
    const amp = new Float32Array(n);
    const panL = new Float32Array(n);
    const panR = new Float32Array(n);
    let sumSq = 0;
    for (let v = 0; v < n; v++) {
      const p = n === 1 ? 0 : (2 * v / (n - 1) - 1);
      mul[v] = Math.pow(ratio, p);
      const w = 1 + (ampRatio - 1) * (1 - Math.abs(p));
      amp[v] = w;
      sumSq += w * w;
      let pp = p * pan;
      if (pp < -1) { pp = -1 } else if (pp > 1) { pp = 1 }
      const angle = (pp + 1) * Math.PI / 4;
      panL[v] = Math.SQRT2 * Math.cos(angle);
      panR[v] = Math.SQRT2 * Math.sin(angle);
    }
    const gain = sumSq > 0 ? 1 / Math.sqrt(sumSq) : 0;
    const phases = this.phases;
    const syncOldPh = this.syncOldPh;
    const syncFade = this.syncFade;
    const syncK = this.syncK;
    // Soft-sync fade-length ceiling: about 2ms, later capped per voice to a
    // quarter of the fundamental cycle so a fade never overruns the next reset.
    const fadeSamplesMax = Math.round(sampleRate * 0.002);

    // Ic: frame f's running integral, extended beyond one cycle. Each frame's
    // integral is quasi-periodic: I[k+frameLen] = I[k] + totals[f] (the per-cycle
    // DC ramp), so a read that wraps the frame boundary stays correct. idx is
    // mapped into frame f's segment of the flat integral array.
    const Ic = (idx, f) => {
      const cyc = Math.floor(idx / frameLen);
      return integral[f * frameLen + (idx - cyc * frameLen)] + cyc * totals[f];
    };
    // interpI: Catmull-Rom interpolation of frame f's integral at fractional x,
    // with all taps offset by 'base' to keep magnitudes small (float32 precision).
    const interpI = (x, base, f) => {
      const i0 = Math.floor(x);
      const frac = x - i0;
      const p0 = Ic(i0 - 1, f) - base;
      const p1 = Ic(i0, f) - base;
      const p2 = Ic(i0 + 1, f) - base;
      const p3 = Ic(i0 + 2, f) - base;
      const a = 3 * (p1 - p2) + p3 - p0;
      const b = 2 * p0 - 5 * p1 + 4 * p2 - p3;
      const c = p2 - p0;
      return p1 + 0.5 * frac * (c + frac * (b + frac * a));
    };
    // readFrame: the box-filtered (band-limited) sample for one frame f over the
    // phase span [x0,x1]. The mean over the span is (I(x1) - I(x0)) / (x1 - x0)
    // with I cubically interpolated; for a span too small to average it falls
    // back to a direct Catmull-Rom point read within the frame (also guarding
    // the span -> 0 division when freq is ~0).
    const readFrame = (f, x0, x1, span) => {
      if (span > 1e-4 || span < -1e-4) {
        const base = Ic(Math.floor(x0), f);
        return (interpI(x1, base, f) - interpI(x0, base, f)) / span;
      }
      const fb = f * frameLen;
      const i0 = x0 | 0;
      const frac = x0 - i0;
      const p0 = wave[fb + (i0 === 0 ? frameLen - 1 : i0 - 1)];
      const p1 = wave[fb + i0];
      const p2 = wave[fb + ((i0 + 1) % frameLen)];
      const p3 = wave[fb + ((i0 + 2) % frameLen)];
      const a = 3 * (p1 - p2) + p3 - p0;
      const b = 2 * p0 - 5 * p1 + 4 * p2 - p3;
      const c = p2 - p0;
      return p1 + 0.5 * frac * (c + frac * (b + frac * a));
    };
    // readWarped: band-limited, wt-morphed read for a slave phase p. Applies the
    // pwr/crush phase warps, spans one increment (incR), and lerps the fa/fa+1
    // frames. Shared by the normal read and the soft-sync crossfade's old read so
    // the warp order and span math cannot drift between them.
    const readWarped = (p, incR, fa, fr, lerp, pwr, crushLevels) => {
      if (pwr > 0) { p = Math.pow(p, pwr); }
      if (crushLevels > 0) { p = Math.floor(p * crushLevels) / crushLevels; }
      const x0 = p * frameLen;
      const x1 = x0 + incR * frameLen;
      const span = x1 - x0;
      let s = readFrame(fa, x0, x1, span);
      if (lerp) { s += (readFrame(fa + 1, x0, x1, span) - s) * fr; }
      return s;
    };

    const channel0 = output[0];
    for (let i = 0; i < channel0.length; i++) {
      const frequency = getFrequency(i);
      const detune = getDetune(i);
      const freq = frequency * Math.pow(2, detune / 1200);
      // Hoist the /sampleRate out of the per-voice loop: with unison this saves
      // one divide per voice per sample (n divides -> a single divide). mul[0] is
      // exactly 1 for unison=1, so freqOverSr*mul[0] === freq/sampleRate, keeping
      // the single-voice output bit-for-bit unchanged.
      const freqOverSr = freq / sampleRate;

      // Read the wavetable over the exact span each voice's phase sweeps this
      // sample: a box (moving-average) filter whose width grows with pitch, so
      // harmonics that would alias at high notes are rolled off automatically.
      // wt picks a position across the frames (the same for every voice); the
      // band-limited reads of the two adjacent frames are lerped to morph
      // between them. The n detuned unison voices (each its own freq and phase)
      // are summed into the left/right accumulators via their equal-power pan
      // gains and scaled by gain. Until a wavetable has loaded the output is
      // silent, but every voice's phase still advances.
      let sampleL = 0, sampleR = 0;
      if (haveWave) {
        let wt = getWt(i);
        if (wt < 0) { wt = 0 } else if (wt > 1) { wt = 1 }
        // sync: hard-sync ratio. 0 leaves the phase untouched; otherwise the
        // phase is remapped (phase * sync) % 1 for the lookup, and the read span
        // is scaled by sync too so the box filter still band-limits the faster
        // (restarting) waveform.
        const sync = getSync(i);
        // crush: phase quantisation, expressed in bits. 0 leaves the phase
        // untouched; otherwise the phase (after the sync remap) is quantised to
        // 2^crush steps for a stepped, lo-fi timbre. Like pwm->pwr, we convert
        // bits->levels once per sample here (crushLevels) and feed that to
        // readWarped, which does the floor(phase*levels)/levels snap. The read
        // span is left at the true increment so the box filter still band-limits
        // between the quantised steps.
        const crush = getCrush(i);
        const crushLevels = crush > 0 ? Math.pow(2, crush) : 0;
        // pwm: phase power-warp. The (post-sync) phase is raised to the power
        // 2^pwm before the lookup, skewing the waveform toward its start
        // (pwm>0) or end (pwm<0). pwr>0 acts as the "on" flag; pwm===0 -> pwr 0
        // -> skip (exponent would be 1). Like crush, the read span is left at
        // the true increment.
        const pwm = getPwm(i);
        const pwr = pwm !== 0 ? Math.pow(2, pwm) : 0;
        // formant: formant/warp shift. 0 leaves the read untouched; otherwise the
        // read phase is compressed by fmt = 2^formant (wrapped within the cycle,
        // with the read span scaled to match so the box filter still band-limits
        // the faster local waveform) and the sample windowed by a raised cosine
        // over the fundamental phase, shifting the formants while keeping the pitch.
        const formant = getFormant(i);
        const fmt = formant !== 0 ? Math.pow(2, formant) : 0;
        const fp = wt * (count - 1);
        let fa = fp | 0;
        if (fa > count - 1) { fa = count - 1 }
        const fr = fp - fa;
        const lerp = fr > 0 && fa < count - 1;
        for (let v = 0; v < n; v++) {
          const incV = freqOverSr * mul[v]; // phase step, in cycles per sample
          let ph = phases[v];
          const phFund = ph; // fundamental phase (pre-sync), for the formant window
          let incR = incV;
          // sync > 0: classic hard sync (unchanged). sync < 0: same |sync| ratio,
          // but the reset click is softened by a short crossfade (fading below).
          const fading = sync < 0 && syncFade[v] > 0;
          if (sync > 0) { ph = (ph * sync) % 1; incR = incV * sync; }
          else if (sync < 0) { const sm = -sync; ph = (ph * sm) % 1; incR = incV * sm; }
          // formant: compress the read phase(s) by fmt and scale the read span to
          // match (on top of any sync remap); the raised-cosine window over phFund
          // is applied to the finished sample below. fmt === 0 leaves reads untouched.
          let readPh = ph, readInc = incR, readOld = syncOldPh[v];
          if (fmt > 0) { readPh = (ph * fmt) % 1; readInc = incR * fmt; readOld = (syncOldPh[v] * fmt) % 1; }
          let s = readWarped(readPh, readInc, fa, fr, lerp, pwr, crushLevels);
          if (fading) {
            // Second read of the OLD slave phase, continued as if the reset had
            // not happened, warped by the same pwr/crush and read over the same
            // span. Crossfade OLD -> NEW with a raised-cosine window so the reset
            // discontinuity is smeared over syncK[v] samples instead of clicking.
            let so = readWarped(readOld, readInc, fa, fr, lerp, pwr, crushLevels);
            const g = 1 - (syncFade[v] - 1) / syncK[v]; // new-weight progress 0..1
            const w = 0.5 - 0.5 * Math.cos(Math.PI * g);
            s = so + (s - so) * w;
            syncOldPh[v] += incR;
            syncOldPh[v] -= (syncOldPh[v]) | 0;
            syncFade[v] -= 1;
          }
          // formant window: raised cosine over the fundamental phase, zero at each
          // cycle boundary so the fundamental period (pitch) is preserved.
          if (fmt > 0) { s *= 0.5 - 0.5 * Math.cos(2 * Math.PI * phFund); }
          const sv = s * amp[v];
          sampleL += sv * panL[v];
          sampleR += sv * panR[v];
          phases[v] += incV;
          const wrapped = phases[v] >= 1;
          phases[v] -= (phases[v]) | 0;
          if (wrapped && sync < 0) {
            // A fundamental cycle just completed: arm the soft-sync crossfade for
            // the upcoming reset sample. Seed the old-phase accumulator with the
            // slave phase continued past the reset (phases[v] is the just-wrapped
            // fundamental phase, so + 1 undoes the wrap), and pick a fade length
            // of ~2ms capped to a quarter of the fundamental cycle.
            const sm = -sync;
            syncOldPh[v] = ((phases[v] + 1) * sm) % 1;
            const cyc = incV > 0 ? 1 / incV : 0;
            let k = Math.round(Math.min(fadeSamplesMax, 0.25 * cyc));
            if (k < 1) { k = 0; }
            syncFade[v] = k;
            syncK[v] = k;
          }
        }
        sampleL *= gain;
        sampleR *= gain;
      } else {
        // No wavetable yet: still advance each voice's phase.
        for (let v = 0; v < n; v++) {
          phases[v] += freqOverSr * mul[v];
          phases[v] -= (phases[v]) | 0;
        }
      }
      // Write the panned stereo pair. The node forces a 2-channel output; if it
      // is ever mono, fold the pair down so no voice is dropped.
      if (output.length > 1) { output[0][i] = sampleL; output[1][i] = sampleR }
      else { output[0][i] = (sampleL + sampleR) * 0.5 }
    }
    return true
  }
}
registerProcessor('superosc', SuperOsc);
`
  system.audio.audioWorklet.addModule(
    "data:text/javascript;charset=utf-8," + encodeURIComponent(source)
  )

  // Factory: build a superosc AudioWorkletNode that behaves like a normal
  // WebAudio OscillatorNode, exposing start(time)/stop(time) methods that
  // gate the underlying start/stop audio params.
  return (channels = 2, audio = system.audio) => {
    // `channels` fixes the output channel count. The default follows the
    // unconnected input and is mono; the callers request 2 channels only when a
    // note actually renders a stereo unison `pan` spread, and 1 otherwise so the
    // downstream fx chain stays mono (cheaper) when there's nothing to pan.
    let node = new AudioWorkletNode(audio, "superosc", { outputChannelCount: [channels] })
    node.start = (time = audio.currentTime) => {
      node.parameters.get('start').setValueAtTime(1, time)
    }
    node.stop = (time = audio.currentTime) => {
      node.parameters.get('stop').setValueAtTime(1, time)
    }
    // Set the wavetable from a Float32Array of sample data (eg an AudioBuffer's
    // channel-0 data), sliced into `count` single-cycle frames (default 64, the
    // wt64 standard). The per-frame integrals are precomputed here (off the audio
    // thread) and sent alongside the raw samples. postMessage is sent without a
    // transfer list so the arrays are structure-cloned (copied), leaving the
    // caller's shared buffer intact.
    node.setWave = (data, count = 64, smooth = 0) => {
      let wt = buildWavetableCached(data, count, smooth)
      node.port.postMessage({ wave: wt.wave, integral: wt.integral, totals: wt.totals, frameLen: wt.frameLen, count: wt.count })
    }
    return node
  }
})
