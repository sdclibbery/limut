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
      // start/stop gates, driven by the node's start()/stop() methods
      { name: 'start', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'stop', defaultValue: 0, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.t = 0; // phase, in cycles [0,1) within a single frame
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
    const wave = this.wave;
    const integral = this.integral;
    const totals = this.totals;
    const frameLen = this.frameLen;
    const count = this.count;
    const haveWave = wave && frameLen > 0;

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
      const inc = freq / sampleRate; // phase step, in cycles per sample

      // Read the wavetable over the exact span the phase sweeps this sample: a
      // box (moving-average) filter whose width grows with pitch, so harmonics
      // that would alias at high notes are rolled off automatically. wt picks
      // a position across the frames; the band-limited reads of the two adjacent
      // frames are lerped to morph between them. Until a wavetable has loaded the
      // output is silent, but phase still advances.
      let sample = 0;
      if (haveWave) {
        const x0 = this.t * frameLen;
        const x1 = x0 + inc * frameLen;
        const span = x1 - x0;
        let wt = getWt(i);
        if (wt < 0) { wt = 0 } else if (wt > 1) { wt = 1 }
        const fp = wt * (count - 1);
        let fa = fp | 0;
        if (fa > count - 1) { fa = count - 1 }
        const fr = fp - fa;
        sample = readFrame(fa, x0, x1, span);
        if (fr > 0 && fa < count - 1) {
          sample += (readFrame(fa + 1, x0, x1, span) - sample) * fr;
        }
      }
      // write the same sample to every output channel
      for (let c = 0; c < output.length; c++) { output[c][i] = sample }

      // advance phase (continues even while the wavetable is still loading)
      this.t += inc;
      this.t -= (this.t) | 0;
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
