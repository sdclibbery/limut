'use strict';
define(function (require) {
  let system = require('play/system');
  let VCO  = require("play/synth/io808/basics/vco")
  let VCF  = require("play/synth/io808/basics/vcf")
  let VCA  = require("play/synth/io808/basics/vca")
  let SwingVCA  = require("play/synth/io808/basics/swingVCA")
  let ADGenerator  = require("play/synth/io808/basics/ADGenerator")
  let equalPower  = require("play/synth/io808/equalPower")

  const RIM_CLAVE_FREQ = 1750;
  const CLAVE_FREQ = 2450;
  const RIM_FREQ = 480;

  return function(params, { level, accent, selector }) {
    // parameters
    const outputLevel = equalPower(level) + equalPower(accent);

    const outputVCA = new VCA(system.audio);
    outputVCA.amplitude.value = outputLevel;

    // rimshot modules
    const rimOsc = new VCO('sine', system.audio);
    rimOsc.frequency.value = RIM_FREQ;

    const rimBandFilter = new VCF('bandpass', system.audio);
    rimBandFilter.frequency.value = RIM_FREQ;

    const rimHighFilter = new VCF('highpass', system.audio);
    rimHighFilter.frequency.value = RIM_FREQ;

    const swingVCA = new SwingVCA(system.audio);
    const swingEnv = new ADGenerator('linear', 0.11, 10, 0, 1.7);

    // clave modules
    const claveOsc = new VCO('triangle', system.audio);
    let claveFilter = null;
    // 0 = clave, 1 = rimshot
    if (selector === 0) {
      claveOsc.frequency.value = CLAVE_FREQ;
      claveFilter = new VCF('bandpass', system.audio);
    } else {
      claveOsc.frequency.value = RIM_CLAVE_FREQ;
      claveFilter = new VCF('highpass', system.audio);
    }
    claveFilter.frequency.value = CLAVE_FREQ;

    const claveVCA = new VCA(system.audio);
    const claveEnv = new ADGenerator('exponential', 0.11, 40, 0, 0.7);
    params.endTime = params._time + 0.11/1000 + 40/1000

    // audio routing
    rimOsc.connect(rimBandFilter);
    rimBandFilter.connect(swingVCA);

    claveOsc.connect(claveFilter);
    claveFilter.connect(claveVCA);
    claveVCA.connect(swingVCA);

    swingVCA.connect(rimHighFilter);

    // 0 = clave, 1 = rimshot
    if (selector === 0) {
      claveVCA.connect(outputVCA);
    } else {
      rimHighFilter.connect(outputVCA);
    }

    // modulation routing
    swingEnv.connect(swingVCA.amplitude);
    claveEnv.connect(claveVCA.amplitude);

    // triggering
    claveOsc.start(params._time);
    rimOsc.start(params._time);
    claveEnv.trigger(params._time);
    swingEnv.trigger(params._time);

    // cleanup
    params._destructor.disconnect(claveOsc, rimOsc, swingVCA, claveVCA, rimBandFilter, rimHighFilter, claveFilter, outputVCA)
    params._destructor.stop(claveOsc, rimOsc)

    return outputVCA;
  }
})