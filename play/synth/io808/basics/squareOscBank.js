'use strict';
define(function (require) {
  let VCO  = require("play/synth/io808/basics/vco")
  let VCA  = require("play/synth/io808/basics/vca")
  let WebAudioModule  = require("play/synth/io808/webAudioModule")

  const OSC_FREQUENCIES = [263, 400, 421, 474, 587, 845];
  const OSC_AMPLITUDE = 0.3;

  let oscBank

  let create = (audioCtx) => {
    if (!!oscBank) { return }
    oscBank = OSC_FREQUENCIES.map((freq, index) => {
      const osc = new VCO('square', audioCtx);
      osc.frequency.value = freq;

      const vca = new VCA(audioCtx);
      vca.amplitude.value = OSC_AMPLITUDE;
      osc.connect(vca);

      osc.start(0)
      return { osc, vca };
    })
  }

  class SquareOSCBank {
    constructor(audioCtx) {
      this.output = new VCA(audioCtx);
      this.output.amplitude.value = 1;
      create(audioCtx)
      oscBank.forEach(o => o.vca.connect(this.output))
    }

    start(time) { // Single osc bank starts on creation
    }

    stop() { // Not bothering to clean up now there's just one osc bank
    }
  }

  return WebAudioModule(SquareOSCBank);
})