'use strict';
define(function (require) {
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
    // The waveform is delivered from the main thread via the message port.
    this.port.onmessage = (e) => { this.wave = e.data };
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
    const len = wave ? wave.length : 0;

    const channel0 = output[0];
    for (let i = 0; i < channel0.length; i++) {
      const frequency = getFrequency(i);
      const detune = getDetune(i);
      const freq = frequency * Math.pow(2, detune / 1200);

      // index into the waveform by phase, with 4-point Catmull-Rom cubic
      // interpolation (smoother than linear, still cheap). The wavetable is
      // cyclic so all four taps wrap. Until a waveform has been loaded the
      // output is silent, but phase still advances.
      let sample = 0;
      if (len > 0) {
        const x = this.t * len;
        const i0 = x | 0;
        const frac = x - i0;
        const p0 = wave[i0 === 0 ? len - 1 : i0 - 1];
        const p1 = wave[i0];
        const p2 = wave[(i0 + 1) % len];
        const p3 = wave[(i0 + 2) % len];
        // Catmull-Rom (Horner form): passes through the sample points
        const a = 3 * (p1 - p2) + p3 - p0;
        const b = 2 * p0 - 5 * p1 + 4 * p2 - p3;
        const c = p2 - p0;
        sample = p1 + 0.5 * frac * (c + frac * (b + frac * a));
      }
      // write the same sample to every output channel
      for (let c = 0; c < output.length; c++) { output[c][i] = sample }

      // advance phase (continues even while the waveform is still loading)
      this.t += freq / sampleRate;
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
    // channel-0 data). postMessage is sent without a transfer list so the array
    // is structure-cloned (copied), leaving the caller's shared buffer intact.
    node.setWave = (data) => { node.port.postMessage(data) }
    return node
  }
})
