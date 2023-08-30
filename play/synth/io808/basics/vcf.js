'use strict';
define(function (require) {
  let WebAudioModule  = require("play/synth/io808/webAudioModule")

  class VCF {
    constructor(type, audioCtx) {
      this.filter = audioCtx.createBiquadFilter();

      // set vcf default values
      this.filter.frequency.value = 400;
      this.filter.Q.value = 1;

      // set vcf type given to constructor
      this.filter.type = type;

      // set WebAudioModule requirements
      this.input = this.filter;
      this.output = this.filter;

      // make paramters available for connection
      this.frequency = this.filter.frequency;
      this.Q = this.filter.Q;
    }

    internalDisconnect() {
      this.filter.disconnect()
    }
  }

  return WebAudioModule(VCF);
})