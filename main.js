define(function(require) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; return; }

  var play = require('play/play');

  var metronome = require('rhythm/metronome');
  var metronomeUI = require('rhythm/metronome.ui');

  var beats = require('rhythm/beats');
  var beatsUI = require('rhythm/beats.ui');
  beatsUI.target(beats);

  var drummer = require('rhythm/drummer');
  var drummerUI = require('rhythm/drummer.ui');

  var tick = function () {
    var beat = metronome.update(play.timeNow())
    if (beat) {
      beats.next(beat).map(drummer.event);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
