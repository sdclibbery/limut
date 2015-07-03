requirejs(['play/play', 'play/percussion', 'music/metronome'], function(play, percussion, metronome) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; }

  setInterval(function () {
    metronome.update(play.timeNow(), function (beat) {
      if (beat.strength === 'down') {
        percussion.kick(beat.time);
      }
      if (beat.strength === 'up') {
        percussion.snare(beat.time);
      }
      beat.subBeats.map(function (time) {
        percussion.hat(beat.time + time*beat.duration);
      });
    });
  }, 100);
});
