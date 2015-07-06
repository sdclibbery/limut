// Music Domain

define(function (require) {

var metronome = {
  bpm: 110,
  beats: [ // Each beat is an array of divisions; each division is a strength value from 0 (completely ignored division) to 3 (strongly emphasised division)
    [ 3, 1 ],
    [ 2, 1 ],
    [ 3, 1 ],
    [ 2, 1 ],
  ],

  nextBeat: 0,
  nextBeatIdx: 0
};

metronome.nextBeatAt = function () {
  return metronome.nextBeat;
};

metronome.beatDuration = function () {
  return 60 / metronome.bpm;
};

metronome.update = function (now) {
  var events = [];
  if (now > metronome.nextBeat - 0.1) { // Call back just BEFORE the next beat to make sure that events composed ON the beat can be scheduled accurately
    events = metronome.beats[metronome.nextBeatIdx].map(function (strength, idx, ds) {
      var event = {};
      event.time = metronome.nextBeatAt() + metronome.beatDuration() * (idx / ds.length);
      event.strength = strength;
      return event;
    });
    metronome.nextBeat += metronome.beatDuration();
    metronome.nextBeatIdx = (metronome.nextBeatIdx + 1) % metronome.beats.length;
  }
  return events;
};

return metronome;
});
