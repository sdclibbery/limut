'use strict';
define(function (require) {
  let VCO  = require("play/synth/io808/basics/vco")
  let VCA  = require("play/synth/io808/basics/vca")
  let WebAudioModule  = require("play/synth/io808/webAudioModule")

  const OSC_FREQUENCIES = [263, 400, 421, 474, 587, 845];
  const OSC_AMPLITUDE = 0.3;

  const DEFAULT_OSC_CONFIG = [true, true, true, true, true, true];

  class SquareOSCBank {
    constructor(audioCtx, oscConfig = DEFAULT_OSC_CONFIG) {
      this.output = new VCA(audioCtx);
      this.output.amplitude.value = 1;

      this.oscBank = OSC_FREQUENCIES.map((freq, index) => {
        if (oscConfig[index]) {
          const osc = new VCO('square', audioCtx);
          osc.frequency.value = freq;

          const vca = new VCA(audioCtx);
          vca.amplitude.value = OSC_AMPLITUDE;

          osc.connect(vca);
          vca.connect(this.output);

          return { osc, vca };
        } else {
          return null;
        }
      }).filter(x => !!x);
    }

    start(time) {
      this.oscBank.forEach(({ osc }) => {
        osc.start(time);
      });
    }

    stop() {
      this.oscBank.forEach(({ osc }) => {
        osc.stop();
      });
    }
  }

  return WebAudioModule(SquareOSCBank);
})