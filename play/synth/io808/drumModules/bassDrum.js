'use strict';
define(function (require) {
  let system = require('play/system');
  let VCO  = require("play/synth/io808/basics/vco")
  let VCF  = require("play/synth/io808/basics/vcf")
  let VCA  = require("play/synth/io808/basics/vca")
  let ADGenerator  = require("play/synth/io808/basics/ADGenerator")
  let PulseTrigger  = require("play/synth/io808/basics/pulseTrigger")
  let SoftClipper  = require("play/synth/io808/effects/softClipper")
  let equalPower  = require("play/synth/io808/equalPower")

  const FREQ_AMT = 50;
  const START_FREQ = 48;

  return function(params, { level, accent, tone, decay }) {
    // parameters
    const outputLevel = equalPower(level) + equalPower(accent);
    const vcfFreq = 200 + tone * 20;
    const decayTime = decay * 5 + 50;

    // audio modules
    const vco = new VCO("sine", system.audio);
    vco.frequency.value = START_FREQ;

    const vcf = new VCF("lowpass", system.audio);
    vcf.frequency.value = vcfFreq;
    vcf.Q.value = 1;

    const click = new PulseTrigger(system.audio);

    const vca = new VCA(system.audio);
    vca.amplitude.value = 0;

    const outputVCA = new VCA(system.audio);
    outputVCA.amplitude.value = outputLevel + 0.4;

    const softClipper = new SoftClipper(0.6, system.audio);

    // envelopes
    const oscEnv = new ADGenerator(
      "exponential",
      0.11,
      decayTime,
      START_FREQ,
      FREQ_AMT
    );
    const ampEnv = new ADGenerator("linear", 2, decayTime, 0.0, 1.0);
    params.endTime = params._time + 2/1000 + decayTime/1000

    // module routing
    vco.connect(vca);
    click.connect(vca);
    vca.connect(vcf);
    vcf.connect(softClipper);
    softClipper.connect(outputVCA);

    // envelope routing
    oscEnv.connect(vco.frequency);
    ampEnv.connect(vca.amplitude);

    // envelope/oscillator triggering
    vco.start(params._time);
    ampEnv.trigger(params._time);
    oscEnv.trigger(params._time);
    click.trigger(params._time, system.audio);

    // cleanup
    params._destructor.disconnect(vco, vca, click, vcf, softClipper, outputVCA)
    params._destructor.stop(vco)

    return outputVCA;
  }
})