'use strict';
define(function (require) {
  let system = require('play/system');
  let VCO  = require("play/synth/io808/basics/vco")
  let VCF  = require("play/synth/io808/basics/vcf")
  let VCA  = require("play/synth/io808/basics/vca")
  let ADGenerator  = require("play/synth/io808/basics/ADGenerator")
  let PulseTrigger  = require("play/synth/io808/basics/pulseTrigger")
  let equalPower  = require("play/synth/io808/equalPower")

  // 0 = conga, 1 = tom
  const parameterMap = {
    low: [
      {
        frequencies: [220, 165],
        decay: [180, 200]
      },
      {
        frequencies: [100, 80],
        decay: [200, 140]
      }
    ],

    mid: [
      {
        frequencies: [310, 250],
        decay: [100, 155]
      },
      {
        frequencies: [160, 120],
        decay: [130, 125]
      }
    ],

    high: [
      {
        frequencies: [455, 370],
        decay: [180, 125]
      },
      {
        frequencies: [220, 165],
        decay: [200, 105]
      }
    ]
  };

  return function(type) {
    return function(params, { level, accent, tuning, selector }) {
      // parameters
      const {
        frequencies: [highFreq, lowFreq],
        decay: [oscDecay, noiseDecay]
      } = parameterMap[type][selector];
      const oscFreq = (tuning / 100) * (highFreq - lowFreq) + lowFreq;
      const outputLevel = equalPower(level/4) + equalPower(accent/4);

      // audio modules
      const osc = new VCO('sine', system.audio);
      osc.frequency.value = oscFreq;

      const noiseOsc = new VCO('pink', system.audio);

      const click = new PulseTrigger(system.audio);
      click.gain.amplitude.value = 0.3;

      const noiseVCF = new VCF('lowpass', system.audio);
      noiseVCF.frequency.value = 10000;

      const oscVCA = new VCA(system.audio);
      const noiseVCA = new VCA(system.audio);

      const outputVCA = new VCA(system.audio);
      outputVCA.amplitude.value = outputLevel;

      // envelopes
      const oscEnv = new ADGenerator('linear', 0.1, oscDecay, 0, 1);
      const noiseEnv = new ADGenerator('linear', 0.1, noiseDecay, 0, 0.2);
      params.endTime = params._time + 0.1/1000 + Math.max(oscDecay, noiseDecay)/1000

      // audio routing
      osc.connect(oscVCA);
      oscVCA.connect(outputVCA);

      if (selector === 1) {
        // only the toms get noise
        noiseOsc.connect(noiseVCF);
        noiseVCF.connect(noiseVCA);
        noiseVCA.connect(outputVCA);
      }

      click.connect(outputVCA);

      // modulation routing
      oscEnv.connect(oscVCA.amplitude);
      noiseEnv.connect(noiseVCA.amplitude);

      // envelope/oscillator triggering
      osc.start(params._time);
      noiseOsc.start(params._time);
      click.trigger(params._time, system.audio);

      oscEnv.trigger(params._time);
      noiseEnv.trigger(params._time);

      // cleanup
      params._destructor.disconnect(osc, noiseOsc, click, oscVCA, noiseVCA, noiseVCF, outputVCA)
      params._destructor.stop(osc, noiseOsc)
  
      return outputVCA;
    };
  }
})