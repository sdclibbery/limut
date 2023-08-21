'use strict';
define(function (require) {
  let HiHat  = require("play/synth/io808/drumModules/hiHat")
  let equalPower  = require("play/synth/io808/equalPower")

  return function(params, { level, accent }) {
    // parameters
    const outputLevel = equalPower(level) + equalPower(accent);
    const decay = 50;

    return HiHat(params, outputLevel, decay);
  }
})