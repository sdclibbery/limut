'use strict';
define(function (require) {
  let system = require('play/system');
  let SquareOscBank  = require("play/synth/io808/basics/squareOscBank")
  let VCF  = require("play/synth/io808/basics/vcf")
  let VCA  = require("play/synth/io808/basics/vca")
  let ADGenerator  = require("play/synth/io808/basics/ADGenerator")

  const MID_FILTER_FREQ = 10000;
  const HIGH_FILTER_FREQ = 8000;

  return function(params, outputLevel, decay) {
    // audio modules
    const oscBank = new SquareOscBank(system.audio);

    const midFilter = new VCF('bandpass', system.audio);
    midFilter.frequency.value = MID_FILTER_FREQ;

    const highFilter = new VCF('highpass', system.audio);
    highFilter.frequency.value = HIGH_FILTER_FREQ;

    const outputVCA = new VCA(system.audio);
    outputVCA.amplitude.value = outputLevel;

    const modVCA = new VCA(system.audio);

    // modulators
    const env = new ADGenerator('linear', 0.1, decay, 0, 1);
    params.endTime = params._time + 0.1/1000 + decay/1000

    // audio routing
    oscBank.connect(midFilter);
    midFilter.connect(modVCA);
    modVCA.connect(highFilter);
    highFilter.connect(outputVCA);

    // modulation routing
    env.connect(modVCA.amplitude);

    // envelope/oscillator triggering
    oscBank.start(params._time);
    env.trigger(params._time);

    // cleanup
    params._destructor.disconnect(oscBank, midFilter, modVCA, highFilter, outputVCA)
    params._destructor.stop(oscBank)

    return outputVCA;
  }
})