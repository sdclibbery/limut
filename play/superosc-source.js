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

  // A wt64-style wavetable file packs `count` single-cycle frames end-to-end in
  // one buffer (eg 64 frames of 256 samples). Slice the buffer into `count`
  // equal frames and build buildIntegral's running integral *per frame*: each
  // frame's segment of `integral` resets to 0 at the frame boundary, and
  // `totals[f]` is that frame's whole-cycle sum (its integral's per-cycle
  // increment). frameLen = floor(len/count); any remainder samples are ignored.
  // count===1 reproduces buildIntegral over the whole buffer (one frame). The
  // worklet lerps between adjacent frames to morph across the table.
  const buildWavetable = (data, count) => {
    count = Math.max(1, Math.floor(count) || 1)
    const frameLen = Math.floor(data.length / count)
    const integral = new Float32Array(count * frameLen)
    const totals = new Float32Array(count)
    for (let f = 0; f < count; f++) {
      let acc = 0
      const off = f * frameLen
      for (let k = 0; k < frameLen; k++) { integral[off + k] = acc; acc += data[off + k] }
      totals[f] = acc
    }
    return { wave: data, integral, totals, frameLen, count }
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

    // unison clamp (mirrors the worklet's process()): round, then clamp to 1..16.
    // Crucially a NaN unison must fall back to 1, not slip past both bounds as NaN.
    let clampUnison = (x) => { let n = Math.round(x); if (!(n >= 1)) { n = 1 } else if (n > 16) { n = 16 } return n }
    assert(1, clampUnison(NaN), 'uni clamp NaN -> 1')
    assert(1, clampUnison(0), 'uni clamp 0 -> 1')
    assert(1, clampUnison(-5), 'uni clamp negative -> 1')
    assert(16, clampUnison(99), 'uni clamp >16 -> 16')
    assert(4, clampUnison(4), 'uni clamp 4 -> 4')
    assert(3, clampUnison(3.4), 'uni clamp rounds 3.4 -> 3')

    // sync phase remap (mirrors the worklet's process()): sync>0 remaps the
    // phase to (phase * sync) % 1; sync===0 leaves it untouched.
    let syncPhase = (ph, sync) => (sync > 0 ? (ph * sync) % 1 : ph)
    assert(0.25, syncPhase(0.25, 0), 'sync=0 no-op')
    assert(0.5, syncPhase(0.25, 2), 'sync=2 wraps within cycle')
    assert(0, syncPhase(0.5, 2), 'sync=2 restarts at boundary')
    assert(0.25, syncPhase(0.75, 3), 'sync=3 second restart')

    // crush phase quantisation (mirrors the worklet's process()): crush>0
    // quantises the phase to floor(phase * crush) / crush; crush===0 is a no-op.
    let crushPhase = (ph, crush) => (crush > 0 ? Math.floor(ph * crush) / crush : ph)
    assert(0.37, crushPhase(0.37, 0), 'crush=0 no-op')
    assert(0.25, crushPhase(0.37, 4), 'crush=4 quantises down')
    assert(0.5, crushPhase(0.7, 4), 'crush=4 quantises 0.7')
    assert(0.5, crushPhase(0.9, 2), 'crush=2 two steps')
    assert(0, crushPhase(0.9, 1), 'crush=1 collapses to 0')

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
      // the accumulated phase is remapped phase -> (phase * sync) % 1 before the
      // wavetable lookup, so the waveform restarts sync times per fundamental
      // cycle (the classic hard-sync timbre). Read a-rate so it can be modulated.
      { name: 'sync', defaultValue: 0, minValue: 0, maxValue: 32, automationRate: 'a-rate' },
      // crush: phase quantisation (a "bitcrush" of the phase). 0 disables it (no
      // effect); otherwise the phase (after any sync remap) is quantised to
      // crush discrete steps via floor(phase * crush) / crush before the
      // wavetable lookup, stepping the waveform for a lo-fi/aliased timbre.
      // Read a-rate so it can be modulated.
      { name: 'crush', defaultValue: 0, minValue: 0, maxValue: 4096, automationRate: 'a-rate' },
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
    let n = Math.round(parameters.unison[0]);
    // Written as !(n >= 1) so a NaN unison (eg a bad param expression) falls back
    // to 1 rather than slipping past both bounds and leaving n === NaN (silent).
    if (!(n >= 1)) { n = 1 } else if (n > 16) { n = 16 }
    const ratio = parameters.unisonRatio[0];
    let ampRatio = parameters.unisonAmp[0];
    // NaN/negative amp ratio falls back to 1 (equal voices) rather than silence.
    if (!(ampRatio >= 0)) { ampRatio = 1 }
    const mul = new Float32Array(n);
    const amp = new Float32Array(n);
    let sumSq = 0;
    for (let v = 0; v < n; v++) {
      const p = n === 1 ? 0 : (2 * v / (n - 1) - 1);
      mul[v] = Math.pow(ratio, p);
      const w = 1 + (ampRatio - 1) * (1 - Math.abs(p));
      amp[v] = w;
      sumSq += w * w;
    }
    const gain = sumSq > 0 ? 1 / Math.sqrt(sumSq) : 0;
    const phases = this.phases;

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
      // are summed and scaled by gain. Until a wavetable has loaded the output
      // is silent, but every voice's phase still advances.
      let sample = 0;
      if (haveWave) {
        let wt = getWt(i);
        if (wt < 0) { wt = 0 } else if (wt > 1) { wt = 1 }
        // sync: hard-sync ratio. 0 leaves the phase untouched; otherwise the
        // phase is remapped (phase * sync) % 1 for the lookup, and the read span
        // is scaled by sync too so the box filter still band-limits the faster
        // (restarting) waveform.
        const sync = getSync(i);
        // crush: phase quantisation. 0 leaves the phase untouched; otherwise the
        // phase (after the sync remap) is quantised to crush steps for a
        // stepped, lo-fi timbre. The read span is left at the true increment so
        // the box filter still band-limits between the quantised steps.
        const crush = getCrush(i);
        const fp = wt * (count - 1);
        let fa = fp | 0;
        if (fa > count - 1) { fa = count - 1 }
        const fr = fp - fa;
        const lerp = fr > 0 && fa < count - 1;
        for (let v = 0; v < n; v++) {
          const incV = freqOverSr * mul[v]; // phase step, in cycles per sample
          let ph = phases[v];
          let incR = incV;
          if (sync > 0) { ph = (ph * sync) % 1; incR = incV * sync; }
          if (crush > 0) { ph = Math.floor(ph * crush) / crush; }
          const x0 = ph * frameLen;
          const x1 = x0 + incR * frameLen;
          const span = x1 - x0;
          let s = readFrame(fa, x0, x1, span);
          if (lerp) { s += (readFrame(fa + 1, x0, x1, span) - s) * fr; }
          sample += s * amp[v];
          phases[v] += incV;
          phases[v] -= (phases[v]) | 0;
        }
        sample *= gain;
      } else {
        // No wavetable yet: still advance each voice's phase.
        for (let v = 0; v < n; v++) {
          phases[v] += freqOverSr * mul[v];
          phases[v] -= (phases[v]) | 0;
        }
      }
      // write the same sample to every output channel
      for (let c = 0; c < output.length; c++) { output[c][i] = sample }
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
  return (audio = system.audio) => {
    let node = new AudioWorkletNode(audio, "superosc")
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
    node.setWave = (data, count = 64) => {
      let wt = buildWavetable(data, count)
      node.port.postMessage({ wave: wt.wave, integral: wt.integral, totals: wt.totals, frameLen: wt.frameLen, count: wt.count })
    }
    return node
  }
})
