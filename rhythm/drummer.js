// Performance Domain

define(function (require) {

var percussion = require('rhythm/percussion.play');
var makeBeats = require('rhythm/beats');

var drummer = {
  beats: makeBeats()
};

drummer.beats.event = function (event) {
  percussion[event.value](event.time);
};

return drummer;
});
