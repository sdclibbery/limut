'use strict';
define(function (require) {
  let SoftClipper  = require("play/synth/io808/effects/softClipper")
  let HalfWaveRectifier  = require("play/synth/io808/effects/halfWaveRectifier")
  let VCA  = require("play/synth/io808/basics/vca")
  let WebAudioModule  = require("play/synth/io808/webAudioModule")

  class SwingVCA {
    constructor(audioCtx) {
      this.rectifier = new HalfWaveRectifier(audioCtx);
      this.clipper = new SoftClipper(3, audioCtx);
      this.vca = new VCA(audioCtx);

      this.rectifier.connect(this.clipper);
      this.clipper.connect(this.vca);

      this.amplitude = this.vca.amplitude;

      this.input = this.rectifier.input;
      this.output = this.vca.output;
    }
  }

  return WebAudioModule(SwingVCA);
})