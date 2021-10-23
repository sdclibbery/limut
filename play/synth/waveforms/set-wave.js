'use strict';
define(function (require) {
  let pulse = require('play/synth/waveforms/pulse')

  return (osc, wave) => {
    if (wave === 'pulse') { osc.setPeriodicWave(pulse()) }
    else { osc.type = wave }
  }
});
