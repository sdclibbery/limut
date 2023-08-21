'use strict';
define(function (require) {
  let HiHat  = require("play/synth/io808/drumModules/hiHat")
  let equalPower  = require("play/synth/io808/equalPower")

  return function(params, { level, accent, decay }) {
    // parameters
    const outputLevel = equalPower(level) + equalPower(accent);
    const decayValue = decay * 3.6 + 90;

    return HiHat(params, outputLevel, decayValue);
  }
})