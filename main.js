requirejs(['play/play', 'music/metronome', 'perform/drummer'], function(play, metronome, drummer) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; }

  var tick = function () {
    metronome.update(play.timeNow(), drummer.beat);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
