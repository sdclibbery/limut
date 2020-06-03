define(function(require) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; return; }

  var play = require('play/play');
  var metronome = require('metronome');

  var percussion = require('play/percussion');
  metronome.listen(b => percussion.kick(b.time))

  var tick = function () {
    metronome.update(play.timeNow())
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
