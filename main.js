requirejs(['adapters/play'], function(play) {
  try { if (!AudioContext) { throw 1; } } catch(e) { document.body.innerHTML = 'Web Audio not supported in this browser!'; }

  play.chorus(play.timeNow(), 440, 0.5);
});
