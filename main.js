requirejs(['play/play', 'music/metronome', 'perform/drummer'], function(play, metronome, drummer) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; }

  metronome.listenToBeat(drummer.beat);

  var tick = function () {
    metronome.update(play.timeNow());
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
