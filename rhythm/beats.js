// Music Domain

define(function (require) {

var beats = {};

var strengths = [ // Each beat is an array of divisions; each division is a strength value from 0 (completely ignored division) to 3 (strongly emphasised division)
  [ 3, 1 ],
  [ 2, 1 ],
  [ 3, 1 ],
  [ 2, 1 ],
];
var nextBeatIdx = 0;

beats.strengths = function (ss) {
  strengths = ss;
  nextBeatIdx = nextBeatIdx % strengths.length;
};

beats.next = function (beat) {
  var events = [];
  events = strengths[nextBeatIdx].map(function (strength, idx, ds) {
    var event = {};
    event.time = beat.time + beat.duration * (idx / ds.length);
    event.strength = strength;
    event.beat = beat;
    return event;
  });
  nextBeatIdx = (nextBeatIdx + 1) % strengths.length;
  return events;
};

return beats;
});
