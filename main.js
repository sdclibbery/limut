define(function(require) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; return; }

  var play = require('play/play');

  var metronome = require('rhythm/metronome');
  var metronomeUI = require('rhythm/metronome.ui');

  var drummerUI = require('rhythm/drummer.ui');
  var drummer = require('rhythm/drummer');

  var tick = function () {
    metronome.update(play.timeNow())
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
