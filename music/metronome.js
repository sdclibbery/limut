// Music Domain

define([], function () {

var metronome = {
  bpm: 110,
  nextBeat: 0,
  nextBeatIdx: 0,
  beats: [
    { strength: 'down', subBeats: [ 0.5 ] },
    { strength: 'up', subBeats: [ 0.5 ] }
  ]
};

metronome.nextBeatAt = function () {
  return metronome.nextBeat;
};

metronome.beatDuration = function () {
  return 60 / metronome.bpm;
};

metronome.update = function (now, action) {
  if (now > metronome.nextBeat - 0.1) { // Call back just BEFORE the next beat to make sure that events composed ON the beat can be scheduled accurately
    var beat = metronome.beats[metronome.nextBeatIdx];
    beat.time = metronome.nextBeatAt();
    beat.duration = metronome.beatDuration();
    action(beat);
    metronome.nextBeat += metronome.beatDuration();
    metronome.nextBeatIdx = (metronome.nextBeatIdx + 1) % metronome.beats.length;
  }
};

return metronome;
});
