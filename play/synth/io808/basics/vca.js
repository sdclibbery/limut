'use strict';
define(function (require) {
  let WebAudioModule  = require("play/synth/io808/webAudioModule")

  class VCA {
    constructor(audioCtx) {
      this.gain = audioCtx.createGain();

      // set initial gain value
      this.gain.gain.value = 0;

      // set WebAudioModule requirements
      this.input = this.gain;
      this.output = this.gain;

      // make amplitude parameter available for connection
      this.amplitude = this.gain.gain;
    }

    internalDisconnect() {
      this.gain.disconnect()
    }
  }

  return WebAudioModule(VCA);
})