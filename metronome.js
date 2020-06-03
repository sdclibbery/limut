// Music Domain

define(function (require) {

var metronome = {};

var beatDuration = 60 / 110;
var nextBeatAt = 0;
var count = 0;
var listeners = [];

metronome.nextBeatAt = function () {
  return nextBeatAt;
};

metronome.listen = function (listener) {
  listeners.push(listener);
};

metronome.bpm = function (bpm) {
  if (bpm) { beatDuration = 60/bpm; }
  return 60/beatDuration;
};

metronome.beatDuration = function (d) {
  if (d) { beatDuration = d; }
  return beatDuration;
};

metronome.update = function (now) {
  if (now > nextBeatAt - 0.05) { // Process just BEFORE the next beat to make sure that events composed ON the beat can be scheduled accurately
    var beat = {
      time: nextBeatAt,
      duration: beatDuration,
      count: count+1,
    };
    nextBeatAt += beatDuration;
    count += 1;
    listeners.map(l => l(beat));
  }
};

return metronome;
});
