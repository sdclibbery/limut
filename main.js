define(function(require) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; return; }

  var play = require('play/play');

  var metronome = require('music/metronome');
  var drummer = require('perform/drummer');
  var beatsUI = require('ui/beats');

  var tick = function () {
    metronome.update(play.timeNow()).map(drummer.event);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
