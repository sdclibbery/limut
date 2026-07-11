'use strict';
define(function (require) {
  if (!window.AudioWorkletNode) { return ()=>{} }

  let system = require('play/system')

  // Chaos oscillator worklet: a bank of strange attractors / chaotic maps that emit a
  // deterministic-but-non-repeating signal, usable as both a control-rate LFO and an
  // audio-rate modulation source (the same node works either way because limut connects
  // any a-rate node straight into a target AudioParam). Inspired by Serum's chaos
  // oscillators; the Au5 trick is to FM an oscillator with a slow chaos source for an
  // organic, non-periodic supersaw-style detune.
  //
  // NB: this whole processor is a template literal, so it must contain no backticks
  // anywhere (not even in comments) or it breaks with a SyntaxError.
  const source = `
/* globals sampleRate, registerProcessor, AudioWorkletProcessor */

// we either have 1 (constant) or 128 (per-sample) values for an a-rate param
const paramGetter = (param) => param.length > 1 ? (n) => param[n] : () => param[0];

// Per-algorithm model-time advanced per second at freq=1Hz, chosen so a musically
// useful freq range spans slow LFO wobble up through audio-rate buzz. Approximate;
// tuned by ear. index: 0 lorenz, 1 rossler, 2 thomas, 3 logistic (unused, steps), 4 duffing.
const TIMESCALE = [6.0, 6.0, 6.0, 1.0, 6.0];
// Largest model-time step we integrate in one substep; above this we subdivide so the
// explicit RK2 integrator stays stable even at high freq.
const DT_MAX = 0.02;

class ChaosOsc extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'freq',   defaultValue: 1,   minValue: -20000, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'chaos',  defaultValue: 0.5, minValue: 0,      maxValue: 1,     automationRate: 'a-rate' },
      { name: 'smooth', defaultValue: 0,   minValue: 0,      maxValue: 1,     automationRate: 'a-rate' },
      { name: 'algo',   defaultValue: 0,   minValue: 0,      maxValue: 4,     automationRate: 'k-rate' },
      { name: 'axis',   defaultValue: 0,   minValue: 0,      maxValue: 2,     automationRate: 'k-rate' },
      { name: 'start',  defaultValue: 0,   minValue: 0,      maxValue: 1 },
      { name: 'stop',   defaultValue: 0,   minValue: 0,      maxValue: 1 },
    ];
  }

  constructor(options) {
    super();
    // Seed offsets the initial condition so multiple instances diverge (chaotic systems
    // separate exponentially from nearby starts) - the key to a supersaw stack of chaos
    // mods that never phase-lock. Passed via processorOptions (no message port needed).
    let seed = (options && options.processorOptions && options.processorOptions.seed) || 0;
    let s = (Math.abs(seed) * 0.6180339887498949) % 1; // golden-ratio spread into 0..1
    // Continuous-attractor state (z doubles as the forcing phase for duffing)
    this.x = 0.1 + s * 0.7;
    this.y = 0.0 + s * 0.5;
    this.z = 0.0 + s * 0.3;
    // Discrete-map (logistic) state
    this.mapx = 0.5 + s * 0.3;
    this.phase = s;   // sample-and-hold step phase accumulator
    this.hold = 0;    // last held map output
    // Output one-pole lowpass state
    this.lp = 0;
    // Derivative scratch (avoids per-sample allocation in the RK2 step)
    this.dx = 0; this.dy = 0; this.dz = 0;
  }

  // Write the state derivative for the chosen attractor into this.dx/dy/dz.
  deriv(algo, x, y, z, chaos) {
    if (algo === 0) { // lorenz: two-lobe attractor. rho is the chaos knob (classic ~28)
      let sigma = 10, beta = 8/3, rho = 20 + chaos * 30;
      this.dx = sigma * (y - x);
      this.dy = x * (rho - z) - y;
      this.dz = x * y - beta * z;
    } else if (algo === 1) { // rossler: gentle spiral with periodic spikes. c is the chaos knob
      let a = 0.2, b = 0.2, c = 3 + chaos * 7;
      this.dx = -(y + z);
      this.dy = x + a * y;
      this.dz = b + z * (x - c);
    } else if (algo === 2) { // thomas: cyclically symmetric, self-bounded. smaller b = more chaotic
      let b = 0.21 - chaos * 0.2;
      this.dx = Math.sin(y) - b * x;
      this.dy = Math.sin(z) - b * y;
      this.dz = Math.sin(x) - b * z;
    } else { // duffing: driven double-well. z is the forcing phase; gamma is the chaos knob
      let delta = 0.3, gamma = 0.2 + chaos * 0.4, omega = 1.2;
      this.dx = y;
      this.dy = -delta * y + x - x*x*x + gamma * Math.cos(z);
      this.dz = omega;
    }
  }

  // Normalise the raw state to roughly [-1,1] for the chosen output axis. Offsets centre
  // each axis (attractors have a non-zero mean) so the output is usable as bipolar
  // modulation without a DC-blocker - a DC-blocker fast enough to matter would eat slow LFOs.
  normalise(algo, axis, x, y, z) {
    if (algo === 0) { return axis === 0 ? x/18 : axis === 1 ? y/24 : (z - 24)/24; }
    if (algo === 1) { return axis === 0 ? x/12 : axis === 1 ? y/12 : (z - 6)/12; }
    if (algo === 2) { return axis === 0 ? x/4  : axis === 1 ? y/4  : z/4; }
    return axis === 0 ? x/1.3 : axis === 1 ? y/1.3 : Math.sin(z); // duffing; axis 2 is the drive
  }

  reset() { // recover from a numerical blow-up
    this.x = 0.1; this.y = 0; this.z = 0; this.mapx = 0.5;
  }

  process(inputs, outputs, parameters) {
    if (parameters.start[0] < 0.5) { return true }
    if (parameters.stop[0] > 0.5) { return false }

    const output = outputs[0];
    const algo = parameters.algo[0] | 0;
    const axis = parameters.axis[0] | 0;
    const getFreq = paramGetter(parameters.freq);
    const getChaos = paramGetter(parameters.chaos);
    const getSmooth = paramGetter(parameters.smooth);
    const blockLen = output[0] ? output[0].length : 128;

    for (let i = 0; i < blockLen; i++) {
      const freq = getFreq(i);
      const chaos = getChaos(i);
      const smooth = getSmooth(i);
      let raw;

      if (algo === 3) { // logistic map: sample-and-hold. freq is steps/second
        this.phase += freq / sampleRate;
        let guard = 0;
        while (this.phase >= 1 && guard++ < 64) {
          this.phase -= 1;
          let r = 3.4 + chaos * 0.6; // r 3.4 (periodic) .. 4.0 (full chaos)
          this.mapx = r * this.mapx * (1 - this.mapx);
          if (!(this.mapx >= 0 && this.mapx <= 1)) { this.mapx = 0.5; }
          this.hold = 2 * this.mapx - 1; // 0..1 -> -1..1
        }
        raw = this.hold;
      } else { // continuous attractor: RK2 (midpoint) with substepping for stability
        let dtTotal = freq * TIMESCALE[algo] / sampleRate;
        let nSub = Math.max(1, Math.min(64, Math.ceil(Math.abs(dtTotal) / DT_MAX)));
        let dt = dtTotal / nSub;
        let x = this.x, y = this.y, z = this.z;
        for (let s = 0; s < nSub; s++) {
          this.deriv(algo, x, y, z, chaos);
          let k1x = this.dx, k1y = this.dy, k1z = this.dz;
          this.deriv(algo, x + 0.5*dt*k1x, y + 0.5*dt*k1y, z + 0.5*dt*k1z, chaos);
          x += dt * this.dx; y += dt * this.dy; z += dt * this.dz;
        }
        if (!(isFinite(x) && isFinite(y) && isFinite(z))) { this.reset(); x = this.x; y = this.y; z = this.z; }
        this.x = x; this.y = y; this.z = z;
        raw = this.normalise(algo, axis, x, y, z);
      }

      // Output lowpass: higher smooth = gentler. alpha 1 (passthrough) .. ~0 (frozen);
      // clamped above 0 so it never fully freezes. Tames map steps and de-sharpens
      // audio-rate attractor transitions (reduces aliasing).
      let alpha = smooth <= 0 ? 1 : Math.max(0.0005, (1 - smooth) * (1 - smooth) * (1 - smooth));
      this.lp += alpha * (raw - this.lp);
      let v = this.lp;
      for (let ch = 0; ch < output.length; ch++) { output[ch][i] = v; }
    }
    return true
  }
}
registerProcessor('chaos', ChaosOsc);
`
  system.audio.audioWorklet.addModule("data:text/javascript;charset=utf-8,"+encodeURIComponent(source))

  // Algorithm name -> the k-rate `algo` param index used in the worklet above.
  const CHAOS_TYPES = { lorenz: 0, rossler: 1, thomas: 2, logistic: 3, duffing: 4 };

  // Factory: build a chaos AudioWorkletNode that behaves like a normal OscillatorNode,
  // exposing start(time)/stop(time) that gate the underlying start/stop params. `seed`
  // is baked in at construction (via processorOptions) so instances diverge.
  let factory = (seed = 0, audio = system.audio) => {
    let node = new AudioWorkletNode(audio, "chaos", { outputChannelCount: [1], processorOptions: { seed } })
    node.start = (time = audio.currentTime) => { node.parameters.get('start').setValueAtTime(1, time) }
    node.stop  = (time = audio.currentTime) => { node.parameters.get('stop').setValueAtTime(1, time) }
    return node
  }
  factory.CHAOS_TYPES = CHAOS_TYPES
  return factory
})
