'use strict';
define(function (require) {
  let system = require('play/system');
  let VCO  = require("play/synth/io808/basics/vco")
  let VCF  = require("play/synth/io808/basics/vcf")
  let VCA  = require("play/synth/io808/basics/vca")
  let ADGenerator  = require("play/synth/io808/basics/ADGenerator")
  let equalPower  = require("play/synth/io808/equalPower")

  const BANDPASS_FREQ = 2640;
  const BANDPASS_Q = 1;

  const HIGH_OSC_FREQ = 800;
  const LOW_OSC_FREQ = 540;

  const SHORT_DECAY = 15;
  const LONG_DECAY = 400;
  const LONG_AMT = 0.25;

  return function(params, { level, accent }) {
    // parameters
    const outputLevel = equalPower(level) + equalPower(accent);

    // audio modules
    const highOsc = new VCO('square', system.audio);
    highOsc.frequency.value = HIGH_OSC_FREQ;

    const lowOsc = new VCO('square', system.audio);
    lowOsc.frequency.value = LOW_OSC_FREQ;

    const bandFilter = new VCF('bandpass', system.audio);
    bandFilter.frequency.value = BANDPASS_FREQ;
    bandFilter.Q.value = BANDPASS_Q;

    const shortVCA = new VCA(system.audio);
    const longVCA = new VCA(system.audio);

    const outputVCA = new VCA(system.audio);
    outputVCA.amplitude.value = outputLevel;

    // modulators
    const shortEnv = new ADGenerator(
      'linear',
      0.11,
      SHORT_DECAY,
      0,
      (1.0 - LONG_AMT) / 2
    );
    const longEnv = new ADGenerator(
      'exponential',
      SHORT_DECAY,
      LONG_DECAY,
      0,
      LONG_AMT / 2
    );
    params.endTime = params._time + SHORT_DECAY/1000 + LONG_DECAY/1000

    // audio routing
    highOsc.connect(shortVCA);
    highOsc.connect(longVCA);
    lowOsc.connect(shortVCA);
    lowOsc.connect(longVCA);

    shortVCA.connect(bandFilter);
    longVCA.connect(bandFilter);

    bandFilter.connect(outputVCA);

    // modulator routing
    shortEnv.connect(shortVCA.amplitude);
    longEnv.connect(longVCA.amplitude);

    // triggering
    lowOsc.start(params._time);
    highOsc.start(params._time);
    shortEnv.trigger(params._time);
    longEnv.trigger(params._time);

    // cleanup
    params._destructor.disconnect(highOsc, lowOsc, bandFilter, shortVCA, longVCA, outputVCA)
    params._destructor.stop(highOsc, lowOsc)

    return outputVCA;
  }
})