// Music Domain

define(function (require) {

var metronome = {};

var beatDuration = 60 / 110;
var nextBeatAt = 0;
var nextBeatIdx = 0;
var beatsPerMeasure = 4;

metronome.nextBeatAt = function () {
  return nextBeatAt;
};

metronome.beatDuration = function () {
  return beatDuration;
};

metronome.beatsPerMeasure = function () {
  return beatsPerMeasure;
};

metronome.update = function (now) {
  var beat;
  if (now > nextBeatAt - 0.1) { // Process just BEFORE the next beat to make sure that events composed ON the beat can be scheduled accurately
    beat = {
      time: nextBeatAt,
      duration: beatDuration,
      count: nextBeatIdx+1,
      beatsPerMeasure: beatsPerMeasure,
      down: nextBeatIdx === 0,
      up: nextBeatIdx+1 === beatsPerMeasure
    };
    nextBeatAt += beatDuration;
    nextBeatIdx = (nextBeatIdx + 1) % beatsPerMeasure;
  }
  return beat;
};

return metronome;
});
