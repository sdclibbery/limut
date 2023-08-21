'use strict';
define(function (require) {
  let system = require('play/system');
  let VCO  = require("play/synth/io808/basics/vco")
  let VCF  = require("play/synth/io808/basics/vcf")
  let VCA  = require("play/synth/io808/basics/vca")
  let ADGenerator  = require("play/synth/io808/basics/ADGenerator")
  let SawEnvGenerator  = require("play/synth/io808/basics/sawEnvGenerator")
  let equalPower  = require("play/synth/io808/equalPower")

  // selector: 0 = maracas, 1 = handclap
  return function(params, { level, accent, selector }) {
    // parameters
    const outputLevel = equalPower(level) + equalPower(accent);

    // shared audio modules
    const osc = new VCO('white', system.audio);
    osc.start(params._time);

    const outputVCA = new VCA(system.audio);
    outputVCA.amplitude.value = outputLevel;

    // maracas configuration
    if (selector === 0) {
      // modules
      const maracasFilter = new VCF('highpass', system.audio);
      maracasFilter.frequency.value = 5000;

      const maracasVCA = new VCA(system.audio);
      const maracasEnv = new ADGenerator('linear', 0.2, 30, 0, 0.5);
      params.endTime = params._time + 0.2/1000 + 30/1000

      // routing
      osc.connect(maracasFilter);
      maracasFilter.connect(maracasVCA);
      maracasVCA.connect(outputVCA);

      maracasEnv.connect(maracasVCA.amplitude);

      // triggering
      maracasEnv.trigger(params._time);

      // cleanup
      params._destructor.disconnect(osc, maracasFilter, maracasVCA, outputVCA)
      params._destructor.stop(osc)
    }
    // handclap configuration
    else if (selector === 1) {
      // modules
      const clapFilter = new VCF('bandpass', system.audio);
      clapFilter.frequency.value = 1000;

      const sawVCA = new VCA(system.audio);
      const reverVCA = new VCA(system.audio);

      const sawEnv = new SawEnvGenerator();
      const reverEnv = new ADGenerator('linear', 0.2, 115, 0, 0.75);
      params.endTime = params._time + 0.2/1000 + 115/1000

      // routing
      osc.connect(clapFilter);
      clapFilter.connect(sawVCA);
      clapFilter.connect(reverVCA);
      sawVCA.connect(outputVCA);
      reverVCA.connect(outputVCA);

      sawEnv.connect(sawVCA.amplitude);
      reverEnv.connect(reverVCA.amplitude);

      // triggering
      sawEnv.trigger(params._time);
      reverEnv.trigger(params._time);

      // cleanup
      params._destructor.disconnect(osc, clapFilter, sawVCA, reverVCA, outputVCA)
      params._destructor.stop(osc)
    }

    return outputVCA;
  }
})