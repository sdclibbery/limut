// Music Domain

define(function (require) {

var beats = {};

var values = [ // Each beat is an array of divisions; each division is a value
];
var nextBeatIdx = 0;

beats.lookup = {
  k: 'kick',
  s: 'snare',
  o: 'openhat',
  c: 'closedhat'
};

beats.values = function (vs) {
  values = vs;
  nextBeatIdx = nextBeatIdx % values.length;
};

beats.next = function (beat) {
  var events = [];
  var valuesIdx = Math.min(nextBeatIdx % beat.beatsPerMeasure, values.length-1);
  events = values[valuesIdx].map(function (value, idx, ds) {
    var event = {};
    event.time = beat.time + beat.duration * (idx / ds.length);
    event.value = value;
    event.beat = beat;
    return event;
  });
  nextBeatIdx = (nextBeatIdx + 1) % beat.beatsPerMeasure;
  return events;
};

return beats;
});
