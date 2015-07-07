define(function(require) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; return; }

  var play = require('play/play');

  var metronome = require('rhythm/metronome');
  var drummer = require('rhythm/drummer');
  var beatsUI = require('rhythm/beats.ui');

  var tick = function () {
    metronome.update(play.timeNow()).map(drummer.event);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
