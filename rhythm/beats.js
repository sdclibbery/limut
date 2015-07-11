// Music Domain

define(function (require) {

var beats = {};

var strengths = [ // Each beat is an array of divisions; each division is a strength value from 0 (completely ignored division) to 3 (strongly emphasised division)
];
var nextBeatIdx = 0;

beats.strengths = function (ss) {
  strengths = ss;
  nextBeatIdx = nextBeatIdx % strengths.length;
};

beats.next = function (beat) {
  var events = [];
  var strengthIdx = Math.min(nextBeatIdx % beat.beatsPerMeasure, strengths.length-1);
  events = strengths[strengthIdx].map(function (strength, idx, ds) {
    var event = {};
    event.time = beat.time + beat.duration * (idx / ds.length);
    event.strength = strength;
    event.beat = beat;
    return event;
  });
  nextBeatIdx = (nextBeatIdx + 1) % beat.beatsPerMeasure;
  return events;
};

return beats;
});
