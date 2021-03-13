'use strict';
define(function (require) {
  if (!window.AudioWorkletNode) { return ()=>{} }

  let system = require('play/system')
  if (!system.audio) { return ()=>{} }

 /* From  https://github.com/skratchdot/web-audio-api-v2-issue-7/blob/master/public/pulse-oscillator.js */

const source = `
/* globals currentFrame, currentTime, sampleRate, registerProcessor */

/**
 * Porting some of the polyblep code from:
 * https://github.com/martinfinke/PolyBLEP/blob/master/PolyBLEP.cpp
 * to javascript
 */

// a few default values
const DEFAULT_FREQUENCY = 440;
const DEFAULT_DETUNE = 0;
const DEFAULT_PULSE_WIDTH = 0.5;
const TWOPI = Math.PI * 2;

const bitwiseOrZero = (t) => t | 0;
const square_number = (x) => x * x;
// Adapted from "Phaseshaping Oscillator Algorithms for Musical Sound
// Synthesis" by Jari Kleimola, Victor Lazzarini, Joseph Timoney, and Vesa
// Valimaki.
// http://www.acoustics.hut.fi/publications/papers/smc2010-phaseshaping/
const blep = (t, dt) => {
  if (t < dt) {
    return -square_number(t / dt - 1);
  } else if (t > 1 - dt) {
    return square_number((t - 1) / dt + 1);
  } else {
    return 0;
  }
};

/**
 * helper function for getting audio param values. we either have 1 or 128
 * @param {*} param
 */
const paramGetter = (param) =>
  param.length > 1 ? (n) => param[n] : () => param[0];

/**
 * A Pulse Oscillator with a pulseWidth audioParam.  It should behave
 * very similar to the "square" wave oscillator with the caveat that
 * pulseWidth can be set.
 *
 * https://github.com/WebAudio/web-audio-api-v2/issues/7
 *
 * @class PwmOscillator
 * @extends AudioWorkletProcessor
 */
class PwmOscillator extends AudioWorkletProcessor {
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
      {
        name: 'pulseWidth',
        defaultValue: DEFAULT_PULSE_WIDTH,
        minValue: 0,
        maxValue: 1,
        automationRate: 'a-rate',
      },
      {
        name: "start",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
      },
      {
        name: "stop",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
      }
    ];
  }

  constructor() {
    super();
    this.freq = 0;
    this.amplitude = 1;
    this.t = 0;
  }
  inc() {
    this.t += this.freqInSecondsPerSample;
    this.t -= bitwiseOrZero(this.t);
  }
  getFreqInHz() {
    return this.freqInSecondsPerSample * sampleRate;
  }
  sin() {
    return this.amplitude * Math.sin(TWOPI * this.t);
  }
  saw() {
    let _t = this.t + 0.5;
    _t -= bitwiseOrZero(_t);

    let y = 2 * _t - 1;
    y -= blep(_t, this.freqInSecondsPerSample);

    return this.amplitude * y;
  }
  rect(pulseWidth) {
    let t2 = this.t + 1 - pulseWidth;
    t2 -= bitwiseOrZero(t2);

    let y = -2 * pulseWidth;
    if (this.t < pulseWidth) {
      y += 2;
    }

    y +=
      blep(this.t, this.freqInSecondsPerSample) -
      blep(t2, this.freqInSecondsPerSample);

    return this.amplitude * y;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const getFrequency = paramGetter(parameters.frequency);
    const getDetune = paramGetter(parameters.detune);
    const getPulseWidth = paramGetter(parameters.pulseWidth);

    output.forEach((channel) => {
      for (let i = 0; i < channel.length; i++) {
        // get our current param values
        const frequency = getFrequency(i);
        const detune = getDetune(i);
        const pulseWidth = getPulseWidth(i);
        // calculate frequency
        const freq = Math.abs(frequency * Math.pow(2, detune / 1200));

        // set new phase
        if (this.freq !== freq) {
          this.freq = freq;
          this.freqInSecondsPerSample = freq / sampleRate;
        }
        const out = (this.getFreqInHz() >= sampleRate / 4)
          ? this.sin()
          : this.rect(pulseWidth);
        channel[i] = parameters.start[i%parameters.start.length] * out
        this.inc();
      }
    });
    return parameters.stop[parameters.stop.length-1]<0.5
  }
}
registerProcessor('pwm-oscillator', PwmOscillator);
`
system.audio.audioWorklet.addModule("data:text/javascript;charset=utf-8,"+encodeURIComponent(source))
})
