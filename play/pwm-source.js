'use strict';
define(function (require) {
  if (!window.AudioWorkletNode) { return ()=>{} }

  let system = require('play/system')

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

// Adapted from "Phaseshaping Oscillator Algorithms for Musical Sound
// Synthesis" by Jari Kleimola, Victor Lazzarini, Joseph Timoney, and Vesa
// Valimaki.
// http://www.acoustics.hut.fi/publications/papers/smc2010-phaseshaping/
const blep = (t, dt) => {
  if (t < dt) {
    let x = t / dt - 1;
    return -(x*x);
  } else if (t > 1 - dt) {
    let x = (t - 1) / dt + 1;
    return x*x;
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
  saw() {
    let _t = this.t + 0.5;
    _t -= (_t) | 0;

    let y = 2 * _t - 1;
    y -= blep(_t, this.freqInSecondsPerSample);

    return this.amplitude * y;
  }
  rect(pulseWidth) {
    let t2 = this.t + 1 - pulseWidth;
    t2 -= (t2) | 0;

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
    if (parameters.start[0] < 0.5) { return true }
    if (parameters.stop[0] > 0.5) { return false }

    const output = outputs[0];
    // An a-rate param arrives as either a length-1 array (constant for the block)
    // or a length-128 one. Testing that once per block and indexing directly drops
    // three closure allocations per block and an indirect call per sample; a
    // constant pitch also gets its Math.pow done once instead of 128 times.
    const pFrequency = parameters.frequency, cFrequency = pFrequency.length === 1;
    const pDetune = parameters.detune, cDetune = pDetune.length === 1;
    const pPulseWidth = parameters.pulseWidth, cPulseWidth = pPulseWidth.length === 1;
    const constFreq = cFrequency && cDetune;
    const kFreq = constFreq ? Math.abs(pFrequency[0] * Math.pow(2, pDetune[0] / 1200)) : 0;

    for (let ch = 0; ch < output.length; ch++) {
      const channel = output[ch];
      for (let i = 0; i < channel.length; i++) {
        // get our current param values
        const pulseWidth = cPulseWidth ? pPulseWidth[0] : pPulseWidth[i];

        // calculate frequency
        const freq = constFreq ? kFreq
          : Math.abs(pFrequency[cFrequency ? 0 : i] * Math.pow(2, pDetune[cDetune ? 0 : i] / 1200));

        // set new phase
        let freqInHz = this.freqInSecondsPerSample * sampleRate;
        if (this.freq !== freq) {
          this.freq = freq;
          this.freqInSecondsPerSample = freq / sampleRate;
        }
        // The sine is only used above the quarter-Nyquist crossover, so compute it
        // there rather than every sample (it reads this.t and this.amplitude, which
        // nothing above touches, so the value is unchanged).
        const out = (freqInHz >= sampleRate / 4)
          ? this.amplitude * Math.sin(TWOPI * this.t)
          : this.rect(pulseWidth);
        channel[i] = out

        // inc
        this.t += this.freqInSecondsPerSample;
        this.t -= (this.t) | 0;
      }
    }
    return true
  }
}
registerProcessor('pwm-oscillator', PwmOscillator);
`
system.audio.audioWorklet.addModule("data:text/javascript;charset=utf-8,"+encodeURIComponent(source))
})
