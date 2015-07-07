// Music Domain

define(function (require) {

var metronome = {};

var bpm = 110;
var beats = [ // Each beat is an array of divisions; each division is a strength value from 0 (completely ignored division) to 3 (strongly emphasised division)
  [ 3, 1 ],
  [ 2, 1 ],
  [ 3, 1 ],
  [ 2, 1 ],
];
var nextBeat = 0;
var nextBeatIdx = 0;

metronome.nextBeatAt = function () {
  return nextBeat;
};

metronome.beatDuration = function () {
  return 60 / bpm;
};

metronome.beats = function (bs) {
  beats = bs;
  nextBeatIdx = nextBeatIdx % beats.length;
};

metronome.update = function (now) {
  var events = [];
  if (now > nextBeat - 0.1) { // Call back just BEFORE the next beat to make sure that events composed ON the beat can be scheduled accurately
    events = beats[nextBeatIdx].map(function (strength, idx, ds) {
      var event = {};
      event.time = metronome.nextBeatAt() + metronome.beatDuration() * (idx / ds.length);
      event.strength = strength;
      return event;
    });
    nextBeat += metronome.beatDuration();
    nextBeatIdx = (nextBeatIdx + 1) % beats.length;
  }
  return events;
};

return metronome;
});
