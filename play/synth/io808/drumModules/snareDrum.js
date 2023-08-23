'use strict';
define(function (require) {
  let system = require('play/system');
  let VCO  = require("play/synth/io808/basics/vco")
  let VCF  = require("play/synth/io808/basics/vcf")
  let VCA  = require("play/synth/io808/basics/vca")
  let ADGenerator  = require("play/synth/io808/basics/ADGenerator")
  let equalPower  = require("play/synth/io808/equalPower")

  const highOscFreq = 476;
  const lowOscFreq = 238;

  return function(params, { level, accent, tone, snappy }) {
    // parameters
    const outputLevel = equalPower(level) + equalPower(accent);
    const noiseVCFFreq = tone * 100 + 800;
    const snappyEnvAmt = snappy / 200;

    // audio modules
    const highOsc = new VCO('sine', system.audio);
    highOsc.frequency.value = highOscFreq;

    const lowOsc = new VCO('sine', system.audio);
    lowOsc.frequency.value = lowOscFreq;

    const noiseOsc = new VCO('white', system.audio);

    const noiseVCF = new VCF('highpass', system.audio);
    noiseVCF.frequency.value = noiseVCFFreq;

    const oscVCA = new VCA(system.audio);
    const noiseVCA = new VCA(system.audio);

    const outputVCA = new VCA(system.audio);
    outputVCA.amplitude.value = outputLevel;

    // envelopes
    const noiseEnv = new ADGenerator('linear', 0.1, 75, 0, 0.5);
    const snappyEnv = new ADGenerator('linear', 0.1, 50, 0, snappyEnvAmt);
    params.endTime = params._time + 0.1/1000 + 75/1000

    // module routing
    highOsc.connect(oscVCA);
    lowOsc.connect(oscVCA);
    oscVCA.connect(outputVCA);

    noiseOsc.connect(noiseVCF);
    noiseVCF.connect(noiseVCA);
    noiseVCA.connect(outputVCA);

    // modulation routing
    noiseEnv.connect(noiseVCA.amplitude);
    snappyEnv.connect(oscVCA.amplitude);

    // envelope/oscillator triggering
    highOsc.start(params._time);
    lowOsc.start(params._time);
    noiseOsc.start(params._time);
    noiseEnv.trigger(params._time);
    snappyEnv.trigger(params._time);

    // cleanup
    params._destructor.disconnect(highOsc, lowOsc, noiseOsc, oscVCA, noiseVCF, noiseVCA, outputVCA)
    params._destructor.stop(highOsc, lowOsc, noiseOsc)

    return outputVCA;
  }
})