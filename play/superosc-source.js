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

    console.log('superosc tests complete')
  }

  if (!window.AudioWorkletNode) { return () => {} }

  let system = require('play/system')

  // The audio worklet processor. This runs on the audio thread, so it is
  // defined as a source string and registered via addModule below.
  // "superosc" is a wavetable oscillator: its waveform is a sample buffer
  // (channel-0 Float32 data) sent in via the message port, indexed by phase
  // accumulation (one cycle spans the whole buffer). It is intended to grow
  // lots more functionality over time.
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
      // start/stop gates, driven by the node's start()/stop() methods
      { name: 'start', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'stop', defaultValue: 0, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.t = 0; // phase, in cycles [0,1)
    this.wave = null; // waveform sample data (Float32Array of channel-0 samples)
    this.integral = null; // running integral of the waveform (for band-limited reads)
    this.total = 0; // sum of the whole cycle (the integral's per-cycle increment)
    // The waveform (raw samples + precomputed integral) is delivered from the
    // main thread via the message port.
    this.port.onmessage = (e) => {
      this.wave = e.data.wave;
      this.integral = e.data.integral;
      this.total = e.data.total;
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
    const wave = this.wave;
    const integral = this.integral;
    const total = this.total;
    const len = wave ? wave.length : 0;

    // Ic: the waveform's running integral, extended beyond one cycle. The
    // integral is quasi-periodic: I[k+len] = I[k] + total (the per-cycle DC
    // ramp), so a read that wraps the cycle boundary stays correct.
    const Ic = (idx) => {
      const cyc = Math.floor(idx / len);
      return integral[idx - cyc * len] + cyc * total;
    };
    // interpI: Catmull-Rom interpolation of the integral at fractional x, with
    // all taps offset by 'base' to keep magnitudes small (float32 precision).
    const interpI = (x, base) => {
      const i0 = Math.floor(x);
      const frac = x - i0;
      const p0 = Ic(i0 - 1) - base;
      const p1 = Ic(i0) - base;
      const p2 = Ic(i0 + 1) - base;
      const p3 = Ic(i0 + 2) - base;
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

      // Read the waveform over the exact span the phase sweeps this sample: a
      // box (moving-average) filter whose width grows with pitch, so harmonics
      // that would alias at high notes are rolled off automatically. The mean
      // over [x0,x1] is (I(x1) - I(x0)) / (x1 - x0), with I cubically
      // interpolated so low notes keep smooth (non-aliasing) interpolation.
      // Until a waveform has loaded the output is silent, but phase still advances.
      let sample = 0;
      if (len > 0) {
        const x0 = this.t * len;
        const x1 = x0 + inc * len;
        const span = x1 - x0;
        if (span > 1e-4 || span < -1e-4) {
          const base = Ic(Math.floor(x0));
          sample = (interpI(x1, base) - interpI(x0, base)) / span;
        } else {
          // span too small to average: fall back to a direct Catmull-Rom point
          // read (also guards the span -> 0 division when freq is ~0).
          const i0 = x0 | 0;
          const frac = x0 - i0;
          const p0 = wave[i0 === 0 ? len - 1 : i0 - 1];
          const p1 = wave[i0];
          const p2 = wave[(i0 + 1) % len];
          const p3 = wave[(i0 + 2) % len];
          const a = 3 * (p1 - p2) + p3 - p0;
          const b = 2 * p0 - 5 * p1 + 4 * p2 - p3;
          const c = p2 - p0;
          sample = p1 + 0.5 * frac * (c + frac * (b + frac * a));
        }
      }
      // write the same sample to every output channel
      for (let c = 0; c < output.length; c++) { output[c][i] = sample }

      // advance phase (continues even while the waveform is still loading)
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
    // Set the waveform from a Float32Array of sample data (eg an AudioBuffer's
    // channel-0 data). The running integral is precomputed here (off the audio
    // thread) and sent alongside the raw samples. postMessage is sent without a
    // transfer list so the arrays are structure-cloned (copied), leaving the
    // caller's shared buffer intact.
    node.setWave = (data) => {
      let { integral, total } = buildIntegral(data)
      node.port.postMessage({ wave: data, integral, total })
    }
    return node
  }
})
