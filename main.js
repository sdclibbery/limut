define(function(require) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; return; }

  var play = require('play/play');

  var metronome = require('rhythm/metronome');
  var drummer = require('rhythm/drummer');
  var beats = require('rhythm/beats');
  var beatsUI = require('rhythm/beats.ui');
  beatsUI.target(beats);

  var tick = function () {
    var beat = metronome.update(play.timeNow())
    if (beat) {
      beats.next(beat).map(drummer.event);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
