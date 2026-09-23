'use strict';
define(function (require) {
  // Wavetable generation (buildWavetable/buildWavetableCached and its integral
  // helpers) lives in play/wavetable.js — a reusable main-thread module. setWave
  // (below) precomputes the per-frame integral table there and posts it to the
  // worklet, which only consumes it.
  const { buildWavetableCached } = require('play/wavetable')
  // start()/stop() shim and voice counting, shared with chaos-source and pwm-source
  let workletLifecycle = require('play/worklet-lifecycle')

  // Per-voice frequency multipliers for n unison voices detuned by max ratio: voice v gets
  // ratio^p, p spread over [-1,+1], so the extremes are ratio and 1/ratio and the centre is 1.
  // The interior exponents are perturbed by unisonDetuneOffset: an even spread makes the beat
  // frequencies commensurate, so the stack periodically re-converges in phase (an audible pulse).
  // Kept in sync with the same formula inlined in the worklet's process().
  const PHI = 0.6180339887498949 // golden-ratio fractional part (low-discrepancy)
  const frac = (x) => x - Math.floor(x)
  // Antisymmetric about the centre and zero at the ends and centre, so log-symmetry and the
  // extremes stay exact; only interior voices of n>=4 move. Kept in sync with process().
  const DETUNE_SPREAD = 0.2 // exponent perturbation magnitude, ear-tunable
  const unisonDetuneOffset = (n, v) => {
    const half = (n - 1) / 2
    if (v === 0 || v === n - 1 || v === half) { return 0 }
    const k = Math.min(v, n - 1 - v)
    const g = 2 * frac(k * PHI) - 1
    return DETUNE_SPREAD * g * (v < half ? -1 : 1)
  }

  const unisonMuls = (n, ratio) => {
    const mul = new Float32Array(n)
    for (let v = 0; v < n; v++) {
      const p = n === 1 ? 0 : (2 * v / (n - 1) - 1)
      mul[v] = Math.pow(ratio, p + unisonDetuneOffset(n, v))
    }
    return mul
  }

  // Per-voice amplitude weights: amp at the centre (p=0), 1 at the extremes, linear in |p|.
  // unisonGain normalises loudness by 1/sqrt(sum(w^2)). Kept in sync with process().
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

  // Per-voice equal-power pan gains: outermost voices at ±pan, scaled by sqrt(2) so a centred
  // voice is exactly 1 per channel (pan=0 or unison=1 leave the output unchanged). Returns { l, r }.
  // Kept in sync with process().
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

    // detune perturbation: the antisymmetric offset takes interior voices off the
    // even geometric grid (breaking the periodic phase re-convergence) while keeping
    // log-symmetry and the endpoints/centre exact.
    let m7 = unisonMuls(7, 1.05)
    for (let v = 0; v < 7; v++) { assert(1, m7[v] * m7[7 - 1 - v], 'uni n=7 symmetry ' + v) }
    assert(1 / 1.05, m7[0], 'uni n=7 low endpoint exact'); assert(1.05, m7[6], 'uni n=7 high endpoint exact')
    assert(1, m7[3], 'uni n=7 centre exact')
    // at least one interior voice is moved off the pure-geometric value
    let moved7 = false
    for (let v = 1; v < 6; v++) { if (Math.abs(m7[v] - Math.pow(1.05, 2 * v / 6 - 1)) > 1e-4) { moved7 = true } }
    if (!moved7) { console.trace('superosc uni n=7 interior perturbation Assertion failed: no interior voice moved') }
    // offset is exactly zero at endpoints and the exact centre for odd n
    assert(0, unisonDetuneOffset(7, 0), 'off n=7 v=0'); assert(0, unisonDetuneOffset(7, 6), 'off n=7 v=6'); assert(0, unisonDetuneOffset(7, 3), 'off n=7 centre')
    // amp/pan positions are NOT perturbed (they must stay on the linear grid)
    let a7 = unisonAmps(7, 3)
    assert(3, a7[3], 'amp n=7 centre stays exact'); assert(1, a7[0], 'amp n=7 endpoint stays exact')

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

  // The audio worklet processor, as a source string registered via addModule. A wavetable
  // oscillator: the wavetable arrives over the message port, sliced into count single-cycle
  // frames, and wt morphs across the frames.
  const source = `
/* globals sampleRate, registerProcessor, AudioWorkletProcessor */

const DEFAULT_FREQUENCY = 440;
const DEFAULT_DETUNE = 0;

// Soft-sync fade-length ceiling: about 2ms, later capped per voice to a quarter
// of the fundamental cycle so a fade never overruns the next reset.
const FADE_SAMPLES_MAX = Math.round(sampleRate * 0.002);

// The wavetable of the processor currently inside process(). The read helpers below are the
// hottest code in Limut, so they live at module scope rather than as closures rebuilt every block,
// which the JIT cannot keep warm. Safe because process() calls never interleave; every process()
// sets these before reading them.
//
// Benchmark in SEPARATE PROCESSES, one variant per process: two copies of the processor in one
// process make the p.process(...) call site megamorphic, and the numbers are garbage.
let gWave = null;
let gIntegral = null;
let gTotals = null;
let gFrameLen = 0;

// Ic: frame f's running integral, extended beyond one cycle. Each frame's
// integral is quasi-periodic: I[k+frameLen] = I[k] + totals[f] (the per-cycle
// DC ramp), so a read that wraps the frame boundary stays correct. idx is
// mapped into frame f's segment of the flat integral array.
const Ic = (idx, f) => {
  const cyc = Math.floor(idx / gFrameLen);
  return gIntegral[f * gFrameLen + (idx - cyc * gFrameLen)] + cyc * gTotals[f];
};
// interpI: Catmull-Rom interpolation of frame f's integral at fractional x, with all taps offset
// by 'base' to keep magnitudes small (float32 precision).
//
// This loop is bound by the scattered integral LOADS, not the arithmetic: check once that all four
// taps are inside the frame, then issue four contiguous loads. Guarding each load inside Ic is
// slower, as is saving arithmetic in Ic.
const interpI = (x, base, f) => {
  const i0 = Math.floor(x);
  const frac = x - i0;
  let p0, p1, p2, p3;
  if (i0 >= 1 && i0 + 2 < gFrameLen) {
    const fb = f * gFrameLen + i0;
    p0 = gIntegral[fb - 1] - base;
    p1 = gIntegral[fb] - base;
    p2 = gIntegral[fb + 1] - base;
    p3 = gIntegral[fb + 2] - base;
  } else {
    p0 = Ic(i0 - 1, f) - base;
    p1 = Ic(i0, f) - base;
    p2 = Ic(i0 + 1, f) - base;
    p3 = Ic(i0 + 2, f) - base;
  }
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
    const i0 = Math.floor(x0);
    const base = Ic(i0, f);
    // A span within one sample of the frame (most bass and mid notes) uses the same four taps at
    // both ends, so load them once: identical arithmetic, half the loads.
    if (Math.floor(x1) === i0) {
      // Same four adjacent taps, so the same in-frame fast path as interpI (see
      // the comment there for why the check belongs here and not inside Ic).
      let p0, p1, p2, p3;
      if (i0 >= 1 && i0 + 2 < gFrameLen) {
        const fbi = f * gFrameLen + i0;
        p0 = gIntegral[fbi - 1] - base;
        p1 = gIntegral[fbi] - base;
        p2 = gIntegral[fbi + 1] - base;
        p3 = gIntegral[fbi + 2] - base;
      } else {
        p0 = Ic(i0 - 1, f) - base;
        p1 = Ic(i0, f) - base;
        p2 = Ic(i0 + 1, f) - base;
        p3 = Ic(i0 + 2, f) - base;
      }
      const a = 3 * (p1 - p2) + p3 - p0;
      const b = 2 * p0 - 5 * p1 + 4 * p2 - p3;
      const c = p2 - p0;
      const f0 = x0 - i0;
      const f1 = x1 - i0;
      const v0 = p1 + 0.5 * f0 * (c + f0 * (b + f0 * a));
      const v1 = p1 + 0.5 * f1 * (c + f1 * (b + f1 * a));
      return (v1 - v0) / span;
    }
    return (interpI(x1, base, f) - interpI(x0, base, f)) / span;
  }
  const fb = f * gFrameLen;
  const i0 = x0 | 0;
  const frac = x0 - i0;
  const p0 = gWave[fb + (i0 === 0 ? gFrameLen - 1 : i0 - 1)];
  const p1 = gWave[fb + i0];
  const p2 = gWave[fb + ((i0 + 1) % gFrameLen)];
  const p3 = gWave[fb + ((i0 + 2) % gFrameLen)];
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
  const x0 = p * gFrameLen;
  const x1 = x0 + incR * gFrameLen;
  const span = x1 - x0;
  let s = readFrame(fa, x0, x1, span);
  if (lerp) { s += (readFrame(fa + 1, x0, x1, span) - s) * fr; }
  return s;
};

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
      // sync: hard-sync ratio, 0 disables. The phase is remapped to (phase * |sync|) % 1.
      // sync < 0 softens the reset with a short raised-cosine crossfade (soft sync).
      { name: 'sync', defaultValue: 0, minValue: -32, maxValue: 32, automationRate: 'a-rate' },
      // crush: phase quantisation, 0 disables.
      { name: 'crush', defaultValue: 0, minValue: 0, maxValue: 12, automationRate: 'a-rate' },
      // pwm: phase power-warp ("generalised PWM"). The phase (after any sync
      // remap) is raised to the power 2^pwm before the wavetable lookup,
      // skewing the waveform toward its start (pwm>0) or end (pwm<0). 0 is a
      // no-op (exponent 2^0 = 1). Read a-rate so it can be modulated.
      { name: 'pwm', defaultValue: 0, minValue: -8, maxValue: 8, automationRate: 'a-rate' },
      // formant: 0 disables. Reads each cycle at 2^formant times the rate, windowed by a raised
      // cosine over the fundamental phase, so the pitch holds while the formants shift.
      { name: 'formant', defaultValue: 0, minValue: -4, maxValue: 4, automationRate: 'a-rate' },
      // unison: number of detuned voices. unisonRatio is the max detune ratio. Both k-rate. The
      // unisonRatio default is only a fallback; the synth and node function set it.
      { name: 'unison', defaultValue: 1, minValue: 1, maxValue: 16 },
      { name: 'unisonRatio', defaultValue: 1.01, minValue: 1, maxValue: 4 },
      // unisonAmp: ratio of the centre voice's amplitude to the outermost
      // voices' (1 = all equal). Weights interpolate linearly by pitch position;
      // overall loudness is held roughly constant via 1/sqrt(sum w^2). Read
      // k-rate (once per block, at [0]).
      { name: 'unisonAmp', defaultValue: 1, minValue: 0, maxValue: 8 },
      // unisonPan: stereo width of the voice spread, equal-power. k-rate.
      { name: 'unisonPan', defaultValue: 0.5, minValue: -4, maxValue: 4 },
      // start/stop gates, driven by the node's start()/stop() methods
      { name: 'start', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'stop', defaultValue: 0, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    // Per-voice phase in cycles. Starting phases follow a golden-ratio sequence so they are
    // well spread for any voice count; a different irrational from the detune offset's PHI keeps
    // the two uncorrelated. Voice 0 starts at 0, so unison=1 matches a single oscillator.
    this.phases = new Float32Array(16);
    for (let v = 0; v < 16; v++) { const x = v * 0.7548776662466927; this.phases[v] = x - Math.floor(x); }
    // Soft-sync crossfade state: syncFade[v] is the samples remaining (0 = not fading), syncK[v]
    // the fade length, syncOldPh[v] the old slave phase continuing past the reset.
    this.syncOldPh = new Float32Array(16);
    this.syncFade = new Float32Array(16);
    this.syncK = new Float32Array(16);
    // Unison tables, allocated once at the 16-voice maximum and rebuilt only when a k-rate unison
    // param changes, to avoid allocating on the audio thread. lastN = -1 forces the first build.
    this.mul = new Float32Array(16);
    this.amp = new Float32Array(16);
    this.panL = new Float32Array(16);
    this.panR = new Float32Array(16);
    this.gain = 0;
    this.lastN = -1;
    this.lastRatio = NaN;
    this.lastAmpRatio = NaN;
    this.lastPan = NaN;
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
    // Lifecycle guard, shared by the three worklet oscillators - keep the three copies identical,
    // and see play/worklet-lifecycle.js for why it is inline. stop is tested BEFORE start: a node
    // stopped before it starts must still terminate. The unstarted budget (60s) is the backstop for
    // a node never stopped. Every exit posts 'terminated' first: that message, not stop(), is what
    // decrements the voice count.
    if (parameters.stop[0] > 0.5) { this.port.postMessage('terminated'); return false }
    if (!this.started) {
      // Latch on the LAST sample of the block, not the first. start is an a-rate param, so a
      // gate written part way through a block leaves sample 0 still low while the rest is high;
      // reading only sample 0 dropped that block, and a node whose gate landed in an already
      // rendered block was never seen to start at all.
      const startGate = parameters.start;
      if (startGate[startGate.length-1] >= 0.5) { this.started = true }
      else {
        this.unstartedSamples = (this.unstartedSamples || 0) + 128;
        if (this.unstartedSamples < 60 * sampleRate) { return true }
        this.port.postMessage('terminated'); return false
      }
    }

    const output = outputs[0];
    // An a-rate param is a length-1 or length-128 array. Testing once per block and indexing
    // directly avoids per-block closure allocation and an indirect call per sample.
    const pFrequency = parameters.frequency, cFrequency = pFrequency.length === 1;
    const pDetune = parameters.detune, cDetune = pDetune.length === 1;
    const pWt = parameters.wt, cWt = pWt.length === 1;
    const pSync = parameters.sync, cSync = pSync.length === 1;
    const pCrush = parameters.crush, cCrush = pCrush.length === 1;
    const pPwm = parameters.pwm, cPwm = pPwm.length === 1;
    const pFormant = parameters.formant, cFormant = pFormant.length === 1;
    // Whenever one of those params is constant, its per-sample conversion is the
    // same 128 times over, so do it once here. That matters most for the pitch:
    // a fixed-pitch note was paying a Math.pow every single sample.
    const kSync = cSync ? pSync[0] : 0;
    const kCrushLevels = cCrush ? (pCrush[0] > 0 ? Math.pow(2, pCrush[0]) : 0) : 0;
    const kPwr = cPwm ? (pPwm[0] !== 0 ? Math.pow(2, pPwm[0]) : 0) : 0;
    const kFmt = cFormant ? (pFormant[0] !== 0 ? Math.pow(2, pFormant[0]) : 0) : 0;
    const constFreq = cFrequency && cDetune;
    const kFreqOverSr = constFreq ? (pFrequency[0] * Math.pow(2, pDetune[0] / 1200)) / sampleRate : 0;

    // Publish this processor's wavetable for the module-level read helpers (see
    // the comment on gWave above: process() calls never interleave).
    gWave = this.wave;
    gIntegral = this.integral;
    gTotals = this.totals;
    gFrameLen = this.frameLen;
    const frameLen = this.frameLen;
    const count = this.count;
    const haveWave = gWave && frameLen > 0;

    // wt frame selection, hoisted for a constant wt: which pair of wavetable
    // frames to read and how far between them. Same for every sample when wt does
    // not move, which is the common case.
    let kFa = 0, kFr = 0, kLerp = false;
    if (cWt && haveWave) {
      let wt = pWt[0];
      if (wt < 0) { wt = 0 } else if (wt > 1) { wt = 1 }
      const fp = wt * (count - 1);
      kFa = fp | 0;
      if (kFa > count - 1) { kFa = count - 1 }
      kFr = fp - kFa;
      kLerp = kFr > 0 && kFa < count - 1;
    }

    // Unison: see unisonMuls, unisonAmps and unisonPans above for the formulas, which this inlines.
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
    // The four tables and the gain depend only on the k-rate params read above, so
    // reuse the arrays allocated in the constructor and only rebuild them when one
    // of those params actually changes. A NaN param never compares equal to itself
    // and so simply rebuilds every block, as it did before.
    const mul = this.mul;
    const amp = this.amp;
    const panL = this.panL;
    const panR = this.panR;
    if (n !== this.lastN || ratio !== this.lastRatio || ampRatio !== this.lastAmpRatio || pan !== this.lastPan) {
      this.lastN = n; this.lastRatio = ratio; this.lastAmpRatio = ampRatio; this.lastPan = pan;
      let sumSq = 0;
      const half = (n - 1) / 2;
      for (let v = 0; v < n; v++) {
        const p = n === 1 ? 0 : (2 * v / (n - 1) - 1);
        // Detune offset on the detune exponent only; amp/pan use the unperturbed p. Kept in sync
        // with unisonDetuneOffset() above.
        let off = 0;
        if (v !== 0 && v !== n - 1 && v !== half) {
          const k = Math.min(v, n - 1 - v);
          const kp = k * 0.6180339887498949;
          const g = 2 * (kp - Math.floor(kp)) - 1;
          off = 0.2 * g * (v < half ? -1 : 1);
        }
        mul[v] = Math.pow(ratio, p + off);
        const w = 1 + (ampRatio - 1) * (1 - Math.abs(p));
        amp[v] = w;
        sumSq += w * w;
        let pp = p * pan;
        if (pp < -1) { pp = -1 } else if (pp > 1) { pp = 1 }
        const angle = (pp + 1) * Math.PI / 4;
        panL[v] = Math.SQRT2 * Math.cos(angle);
        panR[v] = Math.SQRT2 * Math.sin(angle);
      }
      this.gain = sumSq > 0 ? 1 / Math.sqrt(sumSq) : 0;
    }
    const gain = this.gain;
    const phases = this.phases;
    const syncOldPh = this.syncOldPh;
    const syncFade = this.syncFade;
    const syncK = this.syncK;

    const channel0 = output[0];
    for (let i = 0; i < channel0.length; i++) {
      // /sampleRate hoisted out of the per-voice loop. mul[0] is exactly 1 for unison=1, so the
      // single-voice output is unchanged.
      const freqOverSr = constFreq ? kFreqOverSr
        : (pFrequency[cFrequency ? 0 : i] * Math.pow(2, pDetune[cDetune ? 0 : i] / 1200)) / sampleRate;

      // Read each voice over the span its phase sweeps this sample: a box filter that widens with
      // pitch, band-limiting high notes. The two frames either side of wt are lerped. Until a
      // wavetable loads the output is silent but phases still advance.
      let sampleL = 0, sampleR = 0;
      if (haveWave) {
        // sync: hard-sync ratio. 0 leaves the phase untouched; otherwise the
        // phase is remapped (phase * sync) % 1 for the lookup, and the read span
        // is scaled by sync too so the box filter still band-limits the faster
        // (restarting) waveform.
        const sync = cSync ? kSync : pSync[i];
        // crush in bits, converted to 2^crush levels. The read span stays at the true increment
        // so the box filter still band-limits between the steps.
        const crushLevels = cCrush ? kCrushLevels : (pCrush[i] > 0 ? Math.pow(2, pCrush[i]) : 0);
        // pwm: the phase is raised to 2^pwm; pwr 0 means off.
        const pwr = cPwm ? kPwr : (pPwm[i] !== 0 ? Math.pow(2, pPwm[i]) : 0);
        // formant: read phase compressed by 2^formant within the cycle, the span scaled to
        // match, and the sample windowed by a raised cosine over the fundamental phase.
        const fmt = cFormant ? kFmt : (pFormant[i] !== 0 ? Math.pow(2, pFormant[i]) : 0);
        // wt frame pair, hoisted above when wt is constant for the block.
        let fa, fr, lerp;
        if (cWt) { fa = kFa; fr = kFr; lerp = kLerp; }
        else {
          let wt = pWt[i];
          if (wt < 0) { wt = 0 } else if (wt > 1) { wt = 1 }
          const fp = wt * (count - 1);
          fa = fp | 0;
          if (fa > count - 1) { fa = count - 1 }
          fr = fp - fa;
          lerp = fr > 0 && fa < count - 1;
        }
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
            // A fundamental cycle just completed: arm the soft-sync crossfade. +1 undoes the
            // wrap to continue the old slave phase; fade ~2ms, capped at a quarter cycle.
            const sm = -sync;
            syncOldPh[v] = ((phases[v] + 1) * sm) % 1;
            const cyc = incV > 0 ? 1 / incV : 0;
            let k = Math.round(Math.min(FADE_SAMPLES_MAX, 0.25 * cyc));
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
    workletLifecycle(node, audio) // start()/stop() gates on the start/stop params, plus the voice count
    // Set the wavetable, sliced into count frames. Integrals are precomputed off the audio thread.
    // postMessage has no transfer list so the arrays are copied, leaving the caller's buffer intact.
    node.setWave = (data, count = 64, smooth = 0) => {
      let wt = buildWavetableCached(data, count, smooth)
      node.port.postMessage({ wave: wt.wave, integral: wt.integral, totals: wt.totals, frameLen: wt.frameLen, count: wt.count })
    }
    return node
  }
})
