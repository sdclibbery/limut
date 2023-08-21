'use strict';
define(function (require) {
  let WebAudioModule  = require("play/synth/io808/webAudioModule")
  let VCA  = require("play/synth/io808/basics/vca")
  // inspired by https://github.com/nick-thompson/neuro/blob/master/lib/effects/WaveShaper.js

  const softClippingCurve = (() => {
    const n = 65536;
    const curve = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const x = (i - n / 2) / (n / 2);
      curve[i] = Math.tanh(x);
    }

    return curve;
  })();

  class SoftClipper {
    constructor(drive, audioCtx) {
      this.gain = new VCA(audioCtx);
      this.gain.amplitude.value = drive;

      this.waveshaper = audioCtx.createWaveShaper();
      this.waveshaper.curve = softClippingCurve;
      this.waveshaper.oversample = "2x";

      this.gain.connect(this.waveshaper);

      this.input = this.gain.gain;
      this.output = this.waveshaper;
    }
  }

  return WebAudioModule(SoftClipper);
})