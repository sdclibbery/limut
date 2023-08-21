'use strict';
define(function (require) {
  let system = require('play/system');
  let SquareOscBank  = require("play/synth/io808/basics/squareOscBank")
  let VCF  = require("play/synth/io808/basics/vcf")
  let VCA  = require("play/synth/io808/basics/vca")
  let ADGenerator  = require("play/synth/io808/basics/ADGenerator")
  let equalPower  = require("play/synth/io808/equalPower")

  const LOW_FILTER_FREQ = 5000;
  const MID_HIGH_FILTER_FREQ = 10000;
  const HIGH_FILTER_FREQ = 8000;
  const HIGH_DECAY = 150;
  const MID_DECAY = 400;

  return function(params, { level, accent, tone, decay }) {
    // parameters
    const outputLevel = equalPower(level)*3/2 + equalPower(accent);
    const lowDecay = decay * 8.5 + 700;

    // tone ratio
    const lowEnvAmt = 0.666 - (tone / 101) * 0.666;
    const midEnvAmt = 0.333;
    const highEnvAmt = 0.666 - (0.99 - tone / 100) * 0.666;

    // audio modules
    const oscBank = new SquareOscBank(system.audio);

    const lowBandFilter = new VCF('bandpass', system.audio);
    lowBandFilter.frequency.value = LOW_FILTER_FREQ;
    const lowVCA = new VCA(system.audio);

    const lowHighpassFilter = new VCF('highpass', system.audio);
    lowHighpassFilter.frequency.value = LOW_FILTER_FREQ;

    const midHighBandFilter = new VCF('bandpass', system.audio);
    midHighBandFilter.frequency.value = MID_HIGH_FILTER_FREQ;
    const midVCA = new VCA(system.audio);

    const midHighpassFilter = new VCF('highpass', system.audio);
    midHighpassFilter.frequency.value = MID_HIGH_FILTER_FREQ;

    const highFilter = new VCF('highpass', system.audio);
    highFilter.frequency.value = HIGH_FILTER_FREQ;
    const highVCA = new VCA(system.audio);

    const outputVCA = new VCA(system.audio);
    outputVCA.amplitude.value = outputLevel;

    // modulators
    // NOTE: for tone control adjust the amounts of each band's env amount instead of having a dedicated mixer node
    const lowEnv = new ADGenerator('exponential', 0.1, lowDecay, 0, lowEnvAmt);
    const midEnv = new ADGenerator('exponential', 0.1, MID_DECAY, 0, midEnvAmt);
    const highEnv = new ADGenerator('exponential', 0.1, HIGH_DECAY, 0, highEnvAmt);
    params.endTime = params._time + 0.1/1000 + lowDecay/1000

    // band splitting
    oscBank.connect(lowBandFilter);
    oscBank.connect(midHighBandFilter);

    // low band routing
    lowBandFilter.connect(lowVCA);
    lowVCA.connect(lowHighpassFilter);
    lowHighpassFilter.connect(outputVCA);

    // mid band routing
    midHighBandFilter.connect(midVCA);
    midVCA.connect(midHighpassFilter);
    midHighpassFilter.connect(outputVCA);

    // high band routing
    midHighBandFilter.connect(highVCA);
    highVCA.connect(highFilter);
    highFilter.connect(outputVCA);

    // modulation routing
    lowEnv.connect(lowVCA.amplitude);
    midEnv.connect(midVCA.amplitude);
    highEnv.connect(highVCA.amplitude);

    // envelope/oscillator triggering
    oscBank.start(params._time);
    lowEnv.trigger(params._time);
    midEnv.trigger(params._time);
    highEnv.trigger(params._time);

    // cleanup
    params._destructor.disconnect(oscBank, lowVCA, lowBandFilter, lowHighpassFilter, midVCA, midHighBandFilter, midHighpassFilter, highVCA, highFilter, outputVCA)
    params._destructor.stop(oscBank)

    return outputVCA;
  }
})