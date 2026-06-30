'use strict';
define(function (require) {
  if (!window.AudioWorkletNode) { return () => {} }

  let system = require('play/system')

  // The audio worklet processor. This runs on the audio thread, so it is
  // defined as a source string and registered via addModule below.
  // "superosc" starts as a simple sine oscillator with frequency + detune
  // params, but is intended to grow lots more functionality over time.
  const source = `
/* globals sampleRate, registerProcessor, AudioWorkletProcessor */

const DEFAULT_FREQUENCY = 440;
const DEFAULT_DETUNE = 0;
const TWOPI = Math.PI * 2;

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
  }

  process(inputs, outputs, parameters) {
    // not started yet: stay alive, output silence
    if (parameters.start[0] < 0.5) { return true }
    // stopped: output silence and let the node be garbage collected
    if (parameters.stop[0] > 0.5) { return false }

    const output = outputs[0];
    const getFrequency = paramGetter(parameters.frequency);
    const getDetune = paramGetter(parameters.detune);

    const channel0 = output[0];
    for (let i = 0; i < channel0.length; i++) {
      const frequency = getFrequency(i);
      const detune = getDetune(i);
      const freq = frequency * Math.pow(2, detune / 1200);

      const sample = Math.sin(TWOPI * this.t);
      // write the same sample to every output channel
      for (let c = 0; c < output.length; c++) { output[c][i] = sample }

      // advance phase
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
    return node
  }
})
